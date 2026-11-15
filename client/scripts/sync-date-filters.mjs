import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../seeker/public/event-date-filters.ts', import.meta.url));
const target = fileURLToPath(new URL('../src/shared/event-date-filters.ts', import.meta.url));
const content = readFileSync(source, 'utf8').replace("from '../types.js'", "from '../../../seeker/types'");
writeFileSync(target, `// Generated from Seeker by scripts/sync-date-filters.mjs. Do not edit.\n${content}`);
