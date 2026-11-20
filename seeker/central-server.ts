import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { startSeeker } from './seeker-server.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const name of ['.env.central', '.env']) {
  const file = join(root, name);
  if (existsSync(file)) loadEnvFile(file);
}

startSeeker();
