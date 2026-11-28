import { useEffect, useState } from 'react';
import { api, isActive, jobLabels, sourceNames, useJobs, type Job } from './data';
import { jobSummary } from './imports';
import { PageHeading, PanelHeading } from './workspace';

type RunStep = { name: string; status: 'completed' | 'failed' | 'skipped'; summary: string };
type Run = { id: number; started_at: string; finished_at: string; origin: 'github' | 'mac' | 'other'; mode: string; status: string; steps: RunStep[]; run_url: string | null };

const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', weekday: 'long', month: 'long', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', hour: '2-digit', minute: '2-digit' });
const origins: Record<Run['origin'], string> = { github: 'GitHub', mac: 'Mac', other: 'script' };
const stepIcons: Record<RunStep['status'], string> = { completed: '✅', failed: '❌', skipped: '⏭️' };
const time = (value: string) => timeFormatter.format(new Date(value));

function JobLine({ job }: { job: Job }) {
  return <div className="activity-item">
    <div>
      <strong>{time(job.started_at)} · {sourceNames[job.source] ?? job.source} · {jobLabels[job.action] ?? job.action}</strong>
      <span className={`job-status status-${job.status}`}>{isActive(job) ? 'running' : job.status}</span>
    </div>
    <small>{job.error_message || jobSummary(job) || ' '}</small>
  </div>;
}

/** One scheduled import: every step's result, with the jobs it started folded underneath. */
function RunEntry({ run, jobs }: { run: Run; jobs: Job[] }) {
  return <div className="activity-item scheduled-run">
    <div>
      <strong>{time(run.started_at)} · {run.mode === 'daily' ? 'Daily import' : `${run.mode[0].toUpperCase()}${run.mode.slice(1)} import`} ({origins[run.origin] ?? run.origin})</strong>
      <span className={`job-status status-${run.status}`}>{run.status}</span>
    </div>
    <ul className="run-steps">
      {run.steps.map(step => <li key={step.name}>{stepIcons[step.status]} <strong>{step.name}</strong>: {step.summary}</li>)}
    </ul>
    <small>
      {jobs.length > 0 && <details><summary>{jobs.length} job{jobs.length === 1 ? '' : 's'} in this run</summary>{jobs.map(job => <JobLine key={job.id} job={job} />)}</details>}
      {run.run_url && <a href={run.run_url} target="_blank" rel="noreferrer">Open on GitHub</a>}
    </small>
  </div>;
}

/**
 * Imports newest first, grouped by day. A scheduled run (GitHub or the Mac) shows as one entry with all its steps;
 * jobs started by hand in Seeker show on their own.
 */
export default function ImportLogPage() {
  const { jobs } = useJobs(() => {});
  const [runs, setRuns] = useState<Run[]>([]);
  useEffect(() => {
    void api<{ runs: Run[] }>('/api/workflow/scheduled-runs').then(result => setRuns(result.runs)).catch(() => setRuns([]));
  }, []);

  // A job belongs to the run it started during. Runs report when they end, so a running one has only its jobs so far.
  const runOf = (job: Job) => runs.find(run => job.started_at >= run.started_at && job.started_at <= run.finished_at);
  type Entry = { at: string; run?: Run; job?: Job };
  const entries: Entry[] = [...runs.map(run => ({ at: run.started_at, run })), ...jobs.filter(job => !runOf(job)).map(job => ({ at: job.started_at, job }))]
    .sort((a, b) => b.at.localeCompare(a.at));
  const days = new Map<string, Entry[]>();
  for (const entry of entries) {
    const day = dayFormatter.format(new Date(entry.at));
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return <>
    <PageHeading title="Import log" icon="clock" description="When each import ran and what it did. A scheduled run from GitHub or the Mac shows all its steps: imports, merged duplicates and artist matching. Jobs started by hand in Seeker show on their own." />
    {!entries.length && <p className="empty-state" role="status">No imports to show yet.</p>}
    {[...days].map(([day, list]) => <section className="panel" key={day}>
      <PanelHeading title={day.charAt(0).toUpperCase() + day.slice(1)} />
      <div className="job-activity">
        {list.map(entry => entry.run
          ? <RunEntry key={`run-${entry.run.id}`} run={entry.run} jobs={jobs.filter(job => runOf(job) === entry.run)} />
          : <JobLine key={`job-${entry.job!.id}`} job={entry.job!} />)}
      </div>
    </section>)}
  </>;
}
