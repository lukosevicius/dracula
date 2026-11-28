import test from 'node:test';
import assert from 'node:assert/strict';
import { saveScheduledRun } from '../dist/imports/scheduled-runs.js';

const run = {
  started_at: '2026-11-28T03:17:02.000Z', finished_at: '2026-11-28T03:21:40.000Z', origin: 'github', mode: 'daily',
  run_url: 'https://github.com/owner/dracula/actions/runs/123',
  steps: [{ name: 'Avilys import', status: 'completed', summary: 'added 9' }, { name: 'Artist matching', status: 'failed', summary: 'HTTP 502' }],
};

test('saves a scheduled run as failed when any step failed', async () => {
  const saved: unknown[][] = [];
  const pool = { execute: async (_sql: string, values: unknown[]) => { saved.push(values); return [[]]; } };
  await saveScheduledRun(pool as never, run);
  assert.equal(saved[0][4], 'failed');
  assert.equal(JSON.parse(String(saved[0][5])).length, 2);
});

test('rejects runs with a bad origin, step or link', async () => {
  const pool = { execute: async () => [[]] };
  for (const bad of [{ ...run, origin: 'laptop' }, { ...run, steps: [{ name: 'x', status: 'maybe', summary: '' }] }, { ...run, run_url: 'https://example.com/x' }, { ...run, started_at: 'yesterday' }]) {
    await assert.rejects(saveScheduledRun(pool as never, bad), /Invalid scheduled run/);
  }
});
