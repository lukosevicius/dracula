import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;
const typescript = join(root, 'node_modules/typescript/bin/tsc');
const vite = join(root, 'node_modules/vite/bin/vite.js');

const build = spawnSync(node, [typescript, '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  const forceStop = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 1500);
  forceStop.unref();
}

function run(args, env = process.env) {
  const child = spawn(node, args, { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.once('error', error => { console.error(error); stop(1); });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      if (signal) console.error(`Development process stopped by ${signal}.`);
      stop(code === 0 ? 0 : 1);
    }
  });
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

run([typescript, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput']);
run(['--watch', join(root, 'dist/central-server.js')], {
  ...process.env,
  PORT: '4178',
  SEEKER_DEV_ORIGIN: 'http://127.0.0.1:4177',
});
run([vite, '--config', 'client/vite.config.ts', '--host', '127.0.0.1', '--port', '4177', '--strictPort']);
