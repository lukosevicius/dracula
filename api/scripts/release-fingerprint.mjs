import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function files(dir) {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const nested = await Promise.all(entries.map(e => e.isDirectory() ? files(`${dir}/${e.name}`) : e.isFile() ? [`${dir}/${e.name}`] : []));
  return nested.flat();
}
const paths = [...await files('src'), 'package.json', 'package-lock.json', 'tsconfig.json'].sort();
const hash = createHash('sha256');
for (const path of paths) {
  const data = await readFile(join(root, path));
  hash.update(`${Buffer.byteLength(path)}:${path}:${data.length}:`); hash.update(data);
}
const fingerprint = hash.digest('hex');
if (process.argv.includes('--write')) await writeFile(join(root, 'dist/release.json'), JSON.stringify({ fingerprint }));
else console.log(fingerprint);
