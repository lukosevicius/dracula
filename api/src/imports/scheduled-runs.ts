/**
 * The scheduled import's own log: each run (from GitHub or the Mac) reports its steps when it ends, and Seeker's
 * Import log shows them next to the import jobs.
 */
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { fail } from '../verification/history.js';

const statuses = ['completed', 'failed', 'skipped'];
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export async function saveScheduledRun(pool: Pool, input: Record<string, unknown>) {
  const { started_at, finished_at, origin, mode, steps, run_url } = input;
  const valid = typeof started_at === 'string' && timestamp.test(started_at) && typeof finished_at === 'string' && timestamp.test(finished_at)
    && typeof origin === 'string' && ['github', 'mac', 'other'].includes(origin) && typeof mode === 'string' && /^[a-z]{1,20}$/.test(mode)
    && Array.isArray(steps) && steps.length <= 20 && steps.every(step => step && typeof step === 'object'
      && typeof step.name === 'string' && step.name.length <= 100 && statuses.includes(step.status) && typeof step.summary === 'string' && step.summary.length <= 1000)
    && (run_url === undefined || run_url === null || (typeof run_url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(run_url)));
  if (!valid) throw fail(400, 'Invalid scheduled run.');
  const list = steps as { name: string; status: string; summary: string }[];
  const status = list.some(step => step.status === 'failed') ? 'failed' : 'completed';
  await pool.execute('INSERT INTO scheduled_runs(started_at,finished_at,origin,mode,status,steps,run_url) VALUES(?,?,?,?,?,?,?)',
    [started_at, finished_at, origin, mode, status, JSON.stringify(list.map(({ name, status, summary }) => ({ name, status, summary }))), run_url ?? null]);
}

export async function listScheduledRuns(pool: Pool) {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM scheduled_runs ORDER BY started_at DESC LIMIT 30');
  return rows.map(row => {
    let steps: unknown = [];
    try { steps = JSON.parse(String(row.steps)); } catch { /* A broken row shows without steps. */ }
    return { id: Number(row.id), started_at: row.started_at, finished_at: row.finished_at, origin: row.origin, mode: row.mode, status: row.status, steps, run_url: row.run_url };
  });
}
