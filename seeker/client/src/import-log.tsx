import { formatDate, isActive, jobLabels, sourceNames, useJobs } from './data';
import { jobSummary } from './imports';
import { PageHeading, PanelHeading } from './workspace';

const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', weekday: 'long', month: 'long', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', hour: '2-digit', minute: '2-digit' });

/** Every import job, newest first and grouped by day: when it ran, what it did and how much it added. */
export default function ImportLogPage() {
  const { jobs } = useJobs(() => {});
  const days = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const day = dayFormatter.format(new Date(job.started_at));
    days.set(day, [...(days.get(day) ?? []), job]);
  }
  return <>
    <PageHeading title="Import log" icon="clock" description="When each import ran and how much it fetched, added and updated. The daily import runs every morning; source pages can start one by hand." />
    {!jobs.length && <p className="empty-state" role="status">No imports to show yet.</p>}
    {[...days].map(([day, list]) => <section className="panel" key={day}>
      <PanelHeading title={day.charAt(0).toUpperCase() + day.slice(1)} />
      <div className="job-activity">
        {list.map(job => <div className="activity-item" key={job.id}>
          <div>
            <strong>{timeFormatter.format(new Date(job.started_at))} · {sourceNames[job.source] ?? job.source} · {jobLabels[job.action] ?? job.action}</strong>
            <span className={`job-status status-${job.status}`}>{isActive(job) ? 'running' : job.status}</span>
          </div>
          <small>{job.error_message || jobSummary(job) || formatDate(job.started_at, true)}</small>
        </div>)}
      </div>
    </section>)}
  </>;
}
