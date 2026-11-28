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

/**
 * Events a run or a single job added, for the Import log. Every import writes an "imported" history entry with its
 * job ID; a listing matched to an existing event writes "source_attached" instead, so duplicates are left out.
 * A scheduled run covers the jobs that started while it ran. Events deleted or merged away since do not show.
 */
export async function addedEvents(pool: Pool, query: URLSearchParams) {
  const id = (key: string) => { const value = query.get(key); return value && /^[1-9]\d{0,11}$/.test(value) ? Number(value) : null; };
  const runId = id('run'), jobId = id('job');
  if ((runId === null) === (jobId === null)) throw fail(400, 'Choose one run or one job.');
  let jobIds: number[] = jobId ? [jobId] : [];
  if (runId) {
    const [runs] = await pool.execute<RowDataPacket[]>('SELECT started_at,finished_at FROM scheduled_runs WHERE id=?', [runId]);
    if (!runs.length) throw fail(404, 'Run not found.');
    const [jobs] = await pool.execute<RowDataPacket[]>('SELECT id FROM jobs WHERE started_at>=? AND started_at<=? ORDER BY id LIMIT 200', [iso(runs[0].started_at), iso(runs[0].finished_at)]);
    jobIds = jobs.map(job => Number(job.id));
  }
  if (!jobIds.length) return { events: [], jobs: [] };
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT e.id,e.title,e.event_date,e.event_time,e.venue,e.city,e.publication_status,e.review_status,h.actor AS source
    FROM event_history h JOIN events e ON e.id=h.event_id
    WHERE h.action='imported' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(h.context,'$.job_id')) AS UNSIGNED) IN (${jobIds.map(() => '?').join(',')})
    ORDER BY e.event_date IS NULL, e.event_date, e.event_time, e.id LIMIT 2000`, jobIds);
  return {
    jobs: jobIds,
    events: rows.map(row => ({ id: Number(row.id), title: String(row.title), event_date: row.event_date ?? null, event_time: row.event_time ?? null, venue: row.venue ?? null,
      city: row.city ?? null, publication_status: String(row.publication_status), review_status: String(row.review_status), source: String(row.source) })),
  };
}

/** Run times come back as Date objects from DATETIME columns or as stored text; jobs store ISO text. */
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
