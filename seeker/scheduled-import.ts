import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createCentralApi } from './central-api.js';
import { createCentralJobs } from './central-jobs.js';

/**
 * Runs the source imports without the Seeker UI:
 *   node dist/scheduled-import.js nightly [--sources=vilnius-events,avilys]
 *   node dist/scheduled-import.js midday  [--sources=vilnius-events,avilys]
 * nightly reads every Vilnius Events list page, midday only the newest. Both refresh upcoming VN details, handle
 * removed VN listings, import Avilys and merge confident duplicates. Vilnius Events refuses GitHub's servers, so
 * the GitHub workflow runs Avilys and a Mac schedule runs Vilnius Events (scripts/vn-import.sh).
 * Jobs use the same leases as Seeker, so a run never overlaps a job started from Seeker.
 */
type Step = { name: string; status: 'completed' | 'failed' | 'skipped'; summary: string };
type Progress = Record<string, unknown>;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const name of ['.env.central', '.env']) {
  const file = join(root, name);
  if (existsSync(file)) loadEnvFile(file);
}

const mode = process.argv[2];
const sourceArg = process.argv.slice(3).find(arg => arg.startsWith('--sources='))?.slice('--sources='.length);
const sources = new Set((sourceArg ?? 'vilnius-events,avilys').split(',').filter(Boolean));
if ((mode !== 'nightly' && mode !== 'midday') || !sources.size || [...sources].some(source => source !== 'vilnius-events' && source !== 'avilys')) {
  console.error('Usage: node dist/scheduled-import.js nightly|midday [--sources=vilnius-events,avilys]');
  process.exit(2);
}
const { CENTRAL_API_URL, CENTRAL_API_TOKEN } = process.env;
if (!CENTRAL_API_URL || !CENTRAL_API_TOKEN) {
  console.error('Set CENTRAL_API_URL and CENTRAL_API_TOKEN.');
  process.exit(2);
}

const api = createCentralApi(CENTRAL_API_URL, CENTRAL_API_TOKEN);
const jobs = createCentralJobs(api, process.env.SEEKER_USER_AGENT || 'Seeker/0.1.0 (scheduled import)');
const steps: Step[] = [];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const describe = (progress: Progress) => Object.entries(progress).map(([key, value]) => `${key} ${value}`).join(', ');

/** Starts a Seeker job and waits until it finishes. Jobs report progress through the API, so the job list is the source of truth. */
async function runJob(input: Parameters<typeof jobs.start>[0], maxMinutes = 90): Promise<Progress> {
  const id = await jobs.start(input);
  const deadline = Date.now() + maxMinutes * 60_000;
  while (Date.now() < deadline) {
    await pause(5000);
    const job = (await api.listJobs()).find(item => item.id === id);
    if (!job || job.status === 'running' || job.status === 'queued') continue;
    let progress: Progress = {};
    try { progress = JSON.parse(job.progress_json || '{}'); } catch { /* Progress is informational. */ }
    if (job.status === 'completed') return progress;
    throw new Error(job.error_message || `Job ${id} ended as ${job.status}.`);
  }
  throw new Error(`Job ${id} did not finish within ${maxMinutes} minutes.`);
}

// The API is occasionally unreachable for a moment, for example while the host restarts it.
const transient = (message: string) => /request failed|request timed out|HTTP 5\d\d|HTTP 408|did not finish|interrupted|fetch failed/i.test(message);

/** Runs a step, retrying it once after a pause when the API was briefly unreachable. Every step is safe to repeat. */
async function step(name: string, work: () => Promise<string>) {
  console.log(`▶ ${name}`);
  for (let attempt = 1; ; attempt++) {
    try {
      const summary = await work();
      steps.push({ name, status: 'completed', summary: attempt > 1 ? `${summary} (after a retry)` : summary });
      console.log(`  ✓ ${summary}`);
      return;
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      if (attempt === 1 && transient(summary)) {
        console.warn(`  … ${summary} Retrying in 60 seconds.`);
        await pause(60_000);
        continue;
      }
      steps.push({ name, status: 'failed', summary });
      console.error(`  ✗ ${summary}`);
      return;
    }
  }
}

if (sources.has('vilnius-events')) await step('Vilnius Events list', async () => describe(await runJob(mode === 'nightly'
  ? { source: 'vilnius-events', action: 'start', pages: 10, include_images: true, verify_after_import: false }
  : { source: 'vilnius-events', action: 'refresh', pages: 1, include_images: true, verify_after_import: false })));

if (sources.has('avilys')) await step('Avilys', async () => {
  // One Avilys job takes at most 200 events (10 pages of 20); continue while a job comes back full.
  const totals: Record<string, number> = {};
  for (let page = 1; page <= 101; page += 10) {
    const progress = await runJob({ source: 'avilys', action: 'import', limit: 200, start_page: page, verify_after_import: false });
    for (const [key, value] of Object.entries(progress)) if (typeof value === 'number') totals[key] = (totals[key] ?? 0) + value;
    if (Number(progress.fetched) < 200) break;
  }
  return describe(totals);
});

// Removals are only judged when Vilnius Events answered normally in this run.
if (sources.has('vilnius-events')) {
  if (steps.find(item => item.name === 'Vilnius Events list')?.status === 'completed') {
    await step('Vilnius Events details and removed listings', async () => describe(await runJob({ source: 'vilnius-events', action: 'refresh-upcoming-details', pages: 1 })));
  } else {
    steps.push({ name: 'Vilnius Events details and removed listings', status: 'skipped', summary: 'Skipped because the Vilnius Events list failed.' });
  }
}

await step('Merge confident duplicates', async () => {
  const result = await api.seekerWrite('/duplicates/merge-confident', {});
  const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
  return `merged ${count(result.merged)}, left for review ${count(result.skipped)}`;
});

const report = [`### Scheduled import (${mode}: ${[...sources].join(', ')})`, '', '| Step | Result | Details |', '| --- | --- | --- |',
  ...steps.map(item => `| ${item.name} | ${item.status === 'completed' ? '✅' : item.status === 'failed' ? '❌' : '⏭️'} ${item.status} | ${item.summary.replace(/\|/g, '/')} |`)].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
console.log('\n' + report);
process.exit(steps.some(item => item.status === 'failed') ? 1 : 0);
