import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [backup, output] = process.argv.slice(2);
const database=process.env.DB_NAME;
if (!backup || !output || !database || !/^[A-Za-z0-9_]+_staging$/.test(database)) throw Error('Usage: DB_NAME=<staging database ending in _staging> node export-staging-sql.mjs <complete backup directory> <new output prefix>');
const base=resolve(backup);
const bytes=readFileSync(`${base}/seeker.sqlite`);
const manifest=JSON.parse(readFileSync(`${base}/manifest.json`));
if(createHash('sha256').update(bytes).digest('hex')!==manifest.databaseSha256) throw Error('Backup hash mismatch');
const db=new DatabaseSync(`${base}/seeker.sqlite`,{readOnly:true});
const tables=['artists','events','event_sources','event_artist_decisions','assistant_event_reviews','event_prices','jobs','ai_evaluations','import_runs','source_state','schema_migrations','vilnius_events','vilnius_event_artists','vilnius_event_runs','vilnius_images'];
const sha=s=>createHash('sha256').update(s).digest('hex');
const value=v=>v===null?'NULL':typeof v==='number'?(Number.isFinite(v)?String(v):(()=>{throw Error('Invalid number')})()):typeof v==='string'?`CONVERT(X'${Buffer.from(v).toString('hex')}' USING utf8mb4)`:(()=>{throw Error('Unexpected type')})();
if(db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Backup integrity check failed');
if(db.prepare("SELECT id FROM jobs WHERE status IN ('running','queued') LIMIT 1").get()) throw Error('Backup contains an active job');
const found=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name).sort();
if(JSON.stringify(found)!==JSON.stringify([...tables].sort())) throw Error('Source tables have changed; review the migration');
let sql=`USE \`${database}\`;\nSET NAMES utf8mb4;\n`+readFileSync(new URL('./schema.sql',import.meta.url),'utf8')+'\nSTART TRANSACTION;\n';
let checks=[];
for(const table of tables){
 const cols=db.prepare(`PRAGMA table_info("${table}")`).all().map(x=>x.name);
 const rows=db.prepare(`SELECT * FROM "${table}"`).all();
 const hashRows=[];
 for(const row of rows){
  const vals=cols.map(c=>value(row[c]));
  sql+=`INSERT INTO \`${table}\` (${cols.map(c=>`\`${c}\``).join(',')}) VALUES (${vals.join(',')});\n`;
  hashRows.push(sha(cols.map(c=>row[c]===null?'N':'V'+Buffer.from(String(row[c])).toString('hex').toUpperCase()).join('|')));
 }
 const rowExpr=`SHA2(CONCAT_WS('|',${cols.map(c=>`IF(\`${c}\` IS NULL,'N',CONCAT('V',HEX(CAST(\`${c}\` AS CHAR CHARACTER SET utf8mb4))))`).join(',')}),256)`;
 checks.push(`SELECT '${table}' AS table_name,COUNT(*) AS rows_found,${rows.length} AS rows_expected, SHA2(COALESCE(GROUP_CONCAT(${rowExpr} ORDER BY ${rowExpr} SEPARATOR ''),''),256)='${sha(hashRows.sort().join(''))}' AS all_values_match FROM \`${table}\``);
}
sql+='COMMIT;\n';
writeFileSync(`${output}-import.sql`,sql,{mode:0o600,flag:'wx'});
writeFileSync(`${output}-verify.sql`,`USE \`${database}\`;\nSET SESSION group_concat_max_len=100000000;\n${checks.join('\nUNION ALL\n')};\n`,{mode:0o600,flag:'wx'});
console.log(JSON.stringify({tables:tables.length,bytes:Buffer.byteLength(sql),backup:base}));
db.close();
