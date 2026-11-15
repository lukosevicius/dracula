import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest('hex');
}

// Produces a new, self-contained staging directory. It never changes an existing destination.
export async function prepareStagingImages(backupPath, destinationPath) {
  const backup = resolve(backupPath), destination = resolve(destinationPath);
  if (destination === backup || destination.startsWith(backup + sep) || backup.startsWith(destination + sep)) throw new Error('Destination must be outside the backup.');
  const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'));
  const databasePath = join(backup, 'seeker.sqlite');
  if (await sha256(databasePath) !== manifest.databaseSha256) throw new Error('Backup database hash does not match its manifest.');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  let rows;
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup database integrity check failed.');
    rows = db.prepare('SELECT media_id, local_name, mime_type FROM vilnius_images ORDER BY media_id').all();
  } finally { db.close(); }
  const sourceImages = new Map(manifest.images.map(image => [image.name, image]));
  const seen = new Set();
  const prepared = [];
  await mkdir(destination, { mode: 0o700 });
  try {
    const imagesDir = join(destination, 'images');
    await mkdir(imagesDir, { mode: 0o700 });
    for (const row of rows) {
      const name = row.local_name;
      if (typeof name !== 'string' || !/^\d+\.(jpg|png|webp|gif)$/.test(name) || name.split('.')[0] !== String(row.media_id) || seen.has(name)) throw new Error('Invalid or duplicate image name in backup.');
      const expectedMime = { jpg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif' }[name.split('.')[1]];
      if (row.mime_type !== expectedMime) throw new Error(`Image type mismatch: ${name}`);
      seen.add(name);
      const entry = sourceImages.get(`vilnius-events/${name}`);
      if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Image not present in backup manifest: ${name}`);
      const source = join(backup, 'images', 'vilnius-events', name);
      const target = join(imagesDir, name);
      if (!(await lstat(source)).isFile()) throw new Error(`Image is not a regular file: ${name}`);
      if (await sha256(source) !== entry.sha256) throw new Error(`Backup image hash mismatch: ${name}`);
      await copyFile(source, target);
      if (await sha256(target) !== entry.sha256) throw new Error(`Copied image hash mismatch: ${name}`);
      prepared.push({ media_id: row.media_id, name, sha256: entry.sha256 });
    }
    await writeFile(join(destination, 'manifest.json'), `${JSON.stringify({ databaseSha256: manifest.databaseSha256, images: prepared }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return { directory: destination, imageCount: prepared.length };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [backup, destination] = process.argv.slice(2);
  if (!backup || !destination) throw new Error('Usage: npm run prepare:images -- <complete-backup-directory> <new-staging-directory>');
  const result = await prepareStagingImages(backup, destination);
  console.log(`Verified ${result.imageCount} images in ${result.directory}`);
}
