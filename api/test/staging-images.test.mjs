import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareStagingImages } from '../prepare-staging-images.mjs';

test('prepares verified images and refuses corrupt input or existing output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dracula-images-'));
  try {
    const backup = join(root, 'backup'), dir = join(backup, 'images', 'vilnius-events');
    await mkdir(dir, { recursive: true });
    const dbPath = join(backup, 'seeker.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE vilnius_images(media_id INTEGER, local_name TEXT, mime_type TEXT); INSERT INTO vilnius_images VALUES(12,'12.jpg','image/jpeg')");
    db.close();
    const digest = data => createHash('sha256').update(data).digest('hex');
    await writeFile(join(dir, '12.jpg'), 'image');
    await writeFile(join(backup, 'manifest.json'), JSON.stringify({ databaseSha256:digest(await readFile(dbPath)), images:[{ name:'vilnius-events/12.jpg', sha256:digest('image') }] }));
    const output = join(root, 'output');
    assert.equal((await prepareStagingImages(backup, output)).imageCount, 1);
    assert.equal(await readFile(join(output,'images','12.jpg'),'utf8'), 'image');
    await assert.rejects(prepareStagingImages(backup, output), { code:'EEXIST' });
    await writeFile(join(dir, '12.jpg'), 'changed');
    await assert.rejects(prepareStagingImages(backup, join(root,'bad')), /hash mismatch/);
    assert.equal(await readFile(join(output,'images','12.jpg'),'utf8'), 'image');
  } finally { await rm(root, { recursive:true, force:true }); }
});
