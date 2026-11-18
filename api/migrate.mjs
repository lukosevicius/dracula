import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const historical = ['001-auto-increment.sql', '002-job-leases.sql', '003-musicbrainz-jobs.sql'];
const historicalChecksums = ['6f147fe566d9b0d504393a4b971e37d2eccad12ee406869f78642a7338b73024', '2db942ba3943f03a7315c5d15ee8600e3ce2f22838141260560210fd1fc77648', '91ab4c090488c7fb62a56c57e00183263fdeb95ba42a0740ebf82cfe6471088c'];
const table = 'api_schema_migrations';

export async function loadMigrations(directory = fileURLToPath(new URL('./migrations/', import.meta.url))) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const seen = new Set();
  return Promise.all(names.map(async name => {
    const match = /^(\d{3})-[a-z0-9-]+\.sql$/.exec(name);
    if (!match || seen.has(Number(match[1]))) throw new Error(`Invalid or duplicate migration version: ${name}`);
    seen.add(Number(match[1]));
    const sql = await readFile(join(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

async function exists(db) {
  const [rows] = await db.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table]);
  return Number(rows[0].n) === 1;
}
async function records(db) {
  if (!await exists(db)) return [];
  const [rows] = await db.query(`SELECT name, checksum, state FROM ${table} ORDER BY name`);
  return rows;
}
function validate(migrations, rows) {
  const byName = new Map(migrations.map(m => [m.name, m]));
  for (const row of rows) {
    if (!byName.has(row.name)) throw new Error(`Applied migration ${row.name} is missing from this checkout`);
    if (byName.get(row.name).checksum !== row.checksum) throw new Error(`Checksum mismatch: ${row.name}`);
    if (row.state !== 'applied') throw new Error(`Migration ${row.name} is ${row.state}; inspect and recover manually before retrying`);
  }
  const applied = new Set(rows.map(r => r.name));
  let gap = false;
  for (const migration of migrations) {
    if (!applied.has(migration.name)) gap = true;
    else if (gap) throw new Error(`Out-of-order migration history at ${migration.name}`);
  }
}
async function verifyHistoricalSchema(db) {
  const idTables = ['events', 'event_sources', 'jobs', 'ai_evaluations', 'import_runs', 'vilnius_event_runs'];
  const [columns] = await db.query("SELECT table_name, column_name, data_type, is_nullable, extra, column_key FROM information_schema.columns WHERE table_schema=DATABASE() AND ((column_name='id' AND table_name IN (?)) OR table_name='job_leases')", [idTables]);
  for (const name of idTables) {
    const col = columns.find(c => c.table_name === name && c.column_name === 'id');
    if (!col || col.data_type !== 'bigint' || col.is_nullable !== 'NO' || !col.extra.toLowerCase().includes('auto_increment')) throw new Error(`Historical schema check failed: ${name}.id`);
  }
  const expected = {source_key:['varchar','NO'],job_id:['bigint','NO'],run_id:['bigint','YES'],import_run_id:['bigint','YES'],owner_hash:['char','NO'],expires_at:['bigint','NO']};
  for (const [name, [type, nullable]] of Object.entries(expected)) {
    const col = columns.find(c => c.table_name === 'job_leases' && c.column_name === name);
    if (!col || col.data_type !== type || col.is_nullable !== nullable || (name === 'source_key' && col.column_key !== 'PRI')) throw new Error(`Historical schema check failed: job_leases.${name}`);
  }
  const [fks] = await db.query("SELECT column_name, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='job_leases' AND referenced_table_name IS NOT NULL");
  for (const [column, target] of Object.entries({job_id:'jobs',run_id:'vilnius_event_runs',import_run_id:'import_runs'})) {
    if (!fks.some(f => f.column_name === column && f.referenced_table_name === target && f.referenced_column_name === 'id')) throw new Error(`Historical schema check failed: job_leases.${column} foreign key`);
  }
}
async function createTracking(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS ${table} (name VARCHAR(191) PRIMARY KEY, checksum CHAR(64) NOT NULL, state VARCHAR(16) NOT NULL, applied_at TIMESTAMP NULL DEFAULT NULL) ENGINE=InnoDB`);
}

export async function migrate(db, action, directory) {
  if (!['status','baseline','up'].includes(action)) throw new Error('Choose status, baseline, or up');
  const migrations = await loadMigrations(directory);
  if (historical.some((name, i) => migrations[i]?.name !== name || migrations[i]?.checksum !== historicalChecksums[i])) throw new Error('Historical migrations are missing, changed, or out of order');
  const [[lock]] = await db.query("SELECT GET_LOCK(CONCAT('dracula-api-migrate:', DATABASE()), 0) AS acquired");
  if (Number(lock.acquired) !== 1) throw new Error('Another migration is running');
  try {
    let rows = await records(db);
    validate(migrations, rows);
    if (action === 'baseline') {
      if (rows.length) throw new Error('Baseline requires an empty API migration history');
      await verifyHistoricalSchema(db);
      await createTracking(db);
      await db.beginTransaction();
      try {
        for (const migration of migrations.slice(0, historical.length)) await db.execute(`INSERT INTO ${table} (name,checksum,state,applied_at) VALUES (?,?,'applied',CURRENT_TIMESTAMP)`, [migration.name,migration.checksum]);
        await db.commit();
      } catch (error) { await db.rollback(); throw error; }
      rows = await records(db);
    }
    if (action === 'up') {
      const applied = new Set(rows.map(row => row.name));
      if (historical.some(name => !applied.has(name))) throw new Error('Historical migrations are not baselined; run baseline only after checking this database');
      for (const migration of migrations.filter(item => !applied.has(item.name))) {
        // DDL can implicitly commit in MariaDB. Leave a durable marker before executing.
        await db.execute(`INSERT INTO ${table} (name,checksum,state) VALUES (?,?,'applying')`, [migration.name,migration.checksum]);
        await db.query(migration.sql);
        await db.execute(`UPDATE ${table} SET state='applied',applied_at=CURRENT_TIMESTAMP WHERE name=?`, [migration.name]);
        console.log(`Applied ${migration.name}`);
      }
      rows = await records(db);
    }
    const applied = new Set(rows.map(row => row.name));
    for (const m of migrations) console.log(`${applied.has(m.name) ? 'applied' : 'pending'} ${m.name}`);
    return rows;
  } finally { await db.query("SELECT RELEASE_LOCK(CONCAT('dracula-api-migrate:', DATABASE()))"); }
}

async function main() {
  const action = process.argv[2] || 'status';
  const {DB_HOST, DB_PORT='3306', DB_USER, DB_PASSWORD, DB_NAME} = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) throw new Error('Set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME');
  const db = await mysql.createConnection({host:DB_HOST, port:Number(DB_PORT), user:DB_USER, password:DB_PASSWORD, database:DB_NAME, multipleStatements:true});
  try { await migrate(db, action); } finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
