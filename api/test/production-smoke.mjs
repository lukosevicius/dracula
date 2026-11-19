import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const {MYSQL_TEST_HOST: host, MYSQL_TEST_PORT: dbPort, MYSQL_TEST_USER: user, MYSQL_TEST_PASSWORD: password, MYSQL_TEST_DATABASE: database} = process.env;
if (!host || !dbPort || !user || !password || !database || !/^[A-Za-z0-9_]+_test$/.test(database)) throw Error('Configure a disposable database ending in _test.');
const probe = createServer();
await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const imageDir = await mkdtemp(join(tmpdir(), 'dracula-nest-production-'));
const child = spawn(process.execPath, ['dist/main.js'], { env: {...process.env, DB_HOST:host, DB_PORT:dbPort, DB_USER:user, DB_PASSWORD:password, DB_NAME:database, PUBLIC_BASE_URL:`http://127.0.0.1:${port}`, IMAGE_DIR:imageDir, PORT:String(port), ADMIN_TOKEN:'0123456789abcdef0123456789abcdef'}, stdio:['ignore','pipe','pipe'] });
let output='';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
try {
  const base=`http://127.0.0.1:${port}`;
  let response;
  for(let n=0;n<100;n++) {
    if(child.exitCode !== null) throw Error(`API exited before startup: ${output}`);
    try { response=await fetch(`${base}/health`); break; } catch { await delay(100); }
  }
  if(!response) throw Error(`API did not start: ${output}`);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:'ok'});
  const events=await fetch(`${base}/v1/events?filter=all&limit=1&offset=0`);
  assert.equal(events.status,200);
  const result=await events.json();assert.ok(Array.isArray(result.items));assert.ok(result.total>=1);
  assert.equal((await fetch(`${base}/v1/admin/events/1`)).status,401);
  console.log('Built NestJS process: health, MariaDB event query and admin authentication passed');
} finally {
  if(child.exitCode===null && child.signalCode===null) {
    const stopped=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');
    await Promise.race([stopped,delay(5000).then(()=>{child.kill('SIGKILL');return stopped;})]);
  }
  await rm(imageDir,{recursive:true,force:true});
}
