import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, 'data');
const source = join(data, 'seeker.sqlite');
const target = join(data, 'backups', `complete-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);

async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function copyImages(sourceDir, targetDir, prefix = '') {
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const files = [];
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const from = join(sourceDir, entry.name);
    const to = join(targetDir, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await copyImages(from, to, name));
    else if (entry.isFile()) {
      const before = await hash(from);
      await copyFile(from, to);
      const [copied, after] = await Promise.all([hash(to), hash(from)]);
      if (before !== copied || before !== after) throw new Error(`Image changed while backing up: ${name}`);
      files.push({ name, sha256: copied, bytes: (await lstat(to)).size });
    } else throw new Error(`Unsupported file in images directory: ${name}`);
  }
  return files;
}

await mkdir(join(data, 'backups'), { recursive: true, mode: 0o700 });
await mkdir(target, { mode: 0o700 });
try {
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, join(target, 'seeker.sqlite')); } finally { db.close(); }
  const snapshot = new DatabaseSync(join(target, 'seeker.sqlite'), { readOnly: true });
  let tables, activeJobs, imageNames;
  try {
    if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    if (snapshot.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign key check failed');
    activeJobs = snapshot.prepare("SELECT id, source, action, status FROM jobs WHERE status IN ('queued','running')").all();
    if (activeJobs.length) throw new Error('A Seeker job is running. Wait for it to finish before backing up.');
    const tableNames = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    tables = Object.fromEntries(tableNames.map(({ name }) => [name, snapshot.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count]));
    imageNames = snapshot.prepare('SELECT local_name FROM vilnius_images').all().map(row => `vilnius-events/${row.local_name}`);
  } finally { snapshot.close(); }
  const images = await copyImages(join(data, 'images'), join(target, 'images'));
  const copied = new Set(images.map(image => image.name));
  const missing = imageNames.filter(name => !copied.has(name));
  if (missing.length) throw new Error(`Database references ${missing.length} missing image(s): ${missing.slice(0, 5).join(', ')}`);
  const manifest = { createdAt: new Date().toISOString(), databaseSha256: await hash(join(target, 'seeker.sqlite')), tables, images };
  await writeFile(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`Verified backup: ${target}\n${Object.keys(tables).length} tables, ${images.length} image files.`);
  console.log('For a final migration, stop Seeker first so the database and images cannot change during the backup.');
} catch (error) {
  await rm(target, { recursive: true, force: true });
  throw error;
}
