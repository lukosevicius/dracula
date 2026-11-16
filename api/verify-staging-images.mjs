import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function sha256(path) {
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

/** Checks a transferred staging directory against the manifest generated at the source. */
export async function verifyStagingImages(directory) {
  const root=resolve(directory), manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
  if (!/^[a-f0-9]{64}$/.test(manifest.databaseSha256) || !Array.isArray(manifest.images)) throw new Error('Invalid image manifest.');
  const names=new Set();
  for(const image of manifest.images) {
    if (!Number.isSafeInteger(image.media_id) || image.media_id<1 || typeof image.name!=='string' || !new RegExp(`^${image.media_id}\\.(jpg|png|webp|gif)$`).test(image.name) || !/^[a-f0-9]{64}$/.test(image.sha256) || names.has(image.name)) throw new Error('Invalid or duplicate image in manifest.');
    names.add(image.name);
    const path=join(root,'images',image.name);
    if (!(await lstat(path)).isFile()) throw new Error(`Image is not a regular file: ${image.name}`);
    if (await sha256(path)!==image.sha256) throw new Error(`Image hash mismatch: ${image.name}`);
  }
  const files=await readdir(join(root,'images'));
  if(files.length!==names.size || files.some(name=>!names.has(name))) throw new Error('Staging directory contains unexpected or missing files.');
  return {databaseSha256:manifest.databaseSha256,imageCount:names.size};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]) throw new Error('Usage: node verify-staging-images.mjs <staging-directory>');
  const result=await verifyStagingImages(process.argv[2]);
  console.log(`Verified ${result.imageCount} images against database backup ${result.databaseSha256}.`);
}
