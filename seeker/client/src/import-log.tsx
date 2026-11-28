import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage, formatDate, isActive, jobLabels, sourceNames, useJobs, type Job } from './data';
import { jobSummary } from './imports';
import { Feedback, PageHeading, PanelHeading } from './workspace';

type RunStep = { name: string; status: 'completed' | 'failed' | 'skipped'; summary: string };
type Run = { id: number; started_at: string; finished_at: string; origin: 'github' | 'mac' | 'other'; mode: string; status: string; steps: RunStep[]; run_url: string | null };

const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', weekday: 'long', month: 'long', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', hour: '2-digit', minute: '2-digit' });
const origins: Record<Run['origin'], string> = { github: 'GitHub', mac: 'Mac', other: 'script' };
const stepIcons: Record<RunStep['status'], string> = { completed: '✅', failed: '❌', skipped: '⏭️' };
const time = (value: string) => timeFormatter.format(new Date(value));

type Added = { id: number; title: string; event_date: string | null; event_time: string | null; venue: string | null; city: string | null; publication_status: string; source: string };

/** New events from one run or job; listings matched to events already in Dracula are not new, so they are left out. */
function AddedEvents({ query }: { query: string }) {
  const [events, setEvents] = useState<Added[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ events: Added[] }>(`/api/workflow/imports/added?${query}`).then(result => setEvents(result.events)).catch(cause => setError(errorMessage(cause)));
  }, [query]);
  if (error) return <Feedback message={error} error />;
  if (!events) return <p className="muted" role="status">Loading added events…</p>;
  if (!events.length) return <p className="muted">No new events: everything was already in Dracula, or has been merged or removed since.</p>;
  return <div className="added-events">
    <p className="muted">{events.length} new event{events.length === 1 ? '' : 's'} (duplicates of existing events not included)</p>
    <ul>{events.map(event => <li key={event.id}>
      <a href={`/event.html?id=${event.id}`}>{event.title}</a>
      <small>{event.event_date ? formatDate(event.event_date) : 'No date'}{event.event_time ? ` ${event.event_time}` : ''}{event.venue ? ` · ${event.venue}` : ''}{event.city ? `, ${event.city}` : ''} · {event.source} · {event.publication_status === 'live' ? 'Live' : 'Draft'}</small>
    </li>)}</ul>
  </div>;
}

/** A log row whose heading opens the events it added. */
function Expandable({ heading, status, query, children }: { heading: string; status: string; query: string | null; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const badge = <span className={`job-status status-${status}`}>{status}</span>;
  return <>
    {query
      ? <button type="button" className="log-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <strong><span aria-hidden="true">{open ? '▾' : '▸'}</span> {heading}</strong>{badge}
        </button>
      : <div><strong>{heading}</strong>{badge}</div>}
    {children}
    {open && query && <AddedEvents query={query} />}
  </>;
}

const importJob = (job: Job) => ['avilys', 'kakava', 'vilnius-events'].includes(job.source) && ['import', 'next', 'start', 'sample', 'refresh'].includes(job.action);

function JobLine({ job }: { job: Job }) {
  return <div className="activity-item">
    <Expandable heading={`${time(job.started_at)} · ${sourceNames[job.source] ?? job.source} · ${jobLabels[job.action] ?? job.action}`}
      status={isActive(job) ? 'running' : job.status} query={importJob(job) ? `job=${job.id}` : null}>
      <small>{job.error_message || jobSummary(job) || ' '}</small>
    </Expandable>
  </div>;
}

/** One scheduled import: every step's result, with the jobs it started folded underneath. */
function RunEntry({ run, jobs }: { run: Run; jobs: Job[] }) {
  return <div className="activity-item scheduled-run">
    <Expandable heading={`${time(run.started_at)} · ${run.mode === 'daily' ? 'Daily import' : `${run.mode[0].toUpperCase()}${run.mode.slice(1)} import`} (${origins[run.origin] ?? run.origin})`}
      status={run.status} query={`run=${run.id}`} />
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
    <PageHeading title="Import log" icon="clock" description="When each import ran and what it did. A scheduled run from GitHub or the Mac shows all its steps: imports, merged duplicates and artist matching. Jobs started by hand in Seeker show on their own. Click a run or an import job to see the new events it added." />
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
