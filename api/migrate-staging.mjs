// One-time import into a new, empty staging database. This is not a live cutover.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const tables=['artists','events','event_sources','event_artist_decisions','assistant_event_reviews','event_prices','jobs','ai_evaluations','import_runs','source_state','schema_migrations','vilnius_events','vilnius_event_artists','vilnius_event_runs','vilnius_images'];
for (const name of ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','BACKUP_SQLITE']) if (!process.env[name]) throw new Error(`Missing ${name}`);
if (!process.env.DB_NAME.endsWith('_staging')) throw new Error('Refusing to import: DB_NAME must end in _staging.');
const snapshotPath=resolve(process.env.BACKUP_SQLITE);
const manifest=JSON.parse(await readFile(resolve(dirname(snapshotPath),'manifest.json'),'utf8'));
const digest=createHash('sha256');
for await (const chunk of createReadStream(snapshotPath)) digest.update(chunk);
if (digest.digest('hex') !== manifest.databaseSha256) throw new Error('Backup does not match its manifest.');
const source=new DatabaseSync(snapshotPath,{readOnly:true});
let conn;
try {
  if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || source.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Source database integrity check failed.');
  if (source.prepare("SELECT id FROM jobs WHERE status IN ('running','queued') LIMIT 1").get()) throw new Error('Backup contains an active job.');
  const actual=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name).sort();
  if (JSON.stringify(actual)!==JSON.stringify([...tables].sort())) throw new Error('Source tables have changed; review the migration before continuing.');
  const port=Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port<1 || port>65535) throw new Error('Invalid DB_PORT.');
  conn=await mysql.createConnection({host:process.env.DB_HOST,port,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,charset:'utf8mb4'});
  const [existing]=await conn.query('SHOW FULL TABLES');
  if (existing.length) throw new Error('Staging database is not empty; refusing to alter it.');
  const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
  for (const statement of schema.split(';').map(s=>s.trim()).filter(Boolean)) await conn.query(statement);
  await conn.beginTransaction();
  try {
    for (const table of tables) {
      const columns=source.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name);
      const [targetColumns]=await conn.query(`SHOW COLUMNS FROM \`${table}\``);
      if (JSON.stringify([...columns].sort())!==JSON.stringify(targetColumns.map(c=>c.Field).sort())) throw new Error(`Column mismatch in ${table}`);
      const quoted=columns.map(c=>`\`${c}\``).join(',');
      const insert=`INSERT INTO \`${table}\` (${quoted}) VALUES (${columns.map(()=>'?').join(',')})`;
      const rows=source.prepare(`SELECT * FROM "${table}"`).all();
      for (const row of rows) await conn.execute(insert,columns.map(c=>row[c]));
      const [copied]=await conn.query(`SELECT ${quoted} FROM \`${table}\``);
      const canonical=items=>items.map(row=>JSON.stringify(columns.map(c=>row[c]))).sort();
      if (JSON.stringify(canonical(rows))!==JSON.stringify(canonical(copied))) throw new Error(`Data verification failed for ${table}`);
      console.log(`Verified ${table}: ${rows.length} rows`);
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  console.log('Staging copy verified. The schema is not ready for Seeker writes or production cutover.');
} finally { source.close(); if (conn) await conn.end(); }
