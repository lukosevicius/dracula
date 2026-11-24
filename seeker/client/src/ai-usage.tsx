import { Fragment, useEffect, useState } from 'react';
import { api, errorMessage } from './data';
import { Feedback, Metrics, PageHeading, Pagination, PanelHeading } from './workspace';
import './ai-usage.css';

const periods = { today: 'Today', week: 'This week', month: 'This month' } as const;
type Period = keyof typeof periods;
type Usage = {
  requests: number; missing_usage: number; unpriced: number;
  input_tokens: number; output_tokens: number; estimated_cost_usd: number | null;
};
type ModelUsage = Usage & { provider: string; model: string };
type Run = {
  id: number; provider: string | null; model: string | null; import_job_id: number | null; actor: string;
  queued_at: string; started_at: string | null; events: number; completed: number; failed: number; skipped: number; pending: number; flagged: number;
};
type Report = {
  activity: { completed: number; failed: number; skipped: number; flagged: number };
  usage: Usage; by_model: ModelUsage[]; runs: Run[]; page: number; total: number; limit: number;
};
type RunEvent = {
  event_id: number; title: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  flagged: number; error_message: string | null;
};

const startTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vilnius' });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 });
const providerName = (provider: string) => provider === 'openai' ? 'OpenAI' : 'Google Gemini';
const cost = (value: number | null) => value === null ? 'Unavailable' : usd.format(value);
const workflow = '/api/workflow/verification';

function checked(run: Pick<Run, 'completed' | 'failed'>) {
  return run.completed + run.failed;
}

function RunEvents({ id }: { id: number }) {
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let active = true;
    void api<{ events: RunEvent[] }>(`${workflow}/jobs/${id}`).then(result => {
      if (active) setEvents(result.events);
    }).catch(error => {
      if (active) setFailure(errorMessage(error));
    });
    return () => { active = false; };
  }, [id]);

  if (failure) return <Feedback message={failure} error />;
  if (!events) return <p role="status">Loading events…</p>;
  if (!events.length) return <p>No events in this run.</p>;
  const statuses = { queued: 'Queued', running: 'Verifying', completed: 'Verified', failed: 'Failed', skipped: 'Skipped' };
  return <ul className="ai-usage-run-events">
    {events.map(event => <li key={event.event_id}>
      <a href={`/event.html?id=${event.event_id}`}>{event.title}</a>
      <small>{statuses[event.status]}{Boolean(event.flagged) && ' · Flagged for review'}{event.error_message && ` · ${event.error_message}`}</small>
    </li>)}
  </ul>;
}

export default function AiUsage() {
  const [period, setPeriod] = useState<Period>('today');
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [failure, setFailure] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setReport(null);
    setFailure('');
    void api<Report>(`${workflow}/usage?period=${period}&page=${page}`).then(value => {
      if (active) setReport(value);
    }).catch(error => {
      if (active) setFailure(errorMessage(error));
    });
    return () => { active = false; };
  }, [period, page]);

  const { activity, usage, by_model: models, runs } = report ?? {};
  return <>
    <PageHeading title="AI usage" description="Track event verification, model usage and estimated costs." icon="clock" />
    <div className="inline-actions" role="group" aria-label="Reporting period">
      {Object.entries(periods).map(([key, label]) => <button key={key} type="button" aria-pressed={key === period}
        className={`secondary-button date-filter-button${key === period ? ' active' : ''}`}
        onClick={() => { setPeriod(key as Period); setPage(1); setExpanded(null); }}>{label}</button>)}
    </div>
    {failure && <Feedback message={failure} error />}
    {!report && !failure && <p className="muted" role="status">Loading AI usage…</p>}
    {activity && usage && models && runs && report && <>
      <Metrics items={[
        { label: 'Events checked', value: checked(activity).toLocaleString(), icon: 'calendar' },
        { label: 'Verified', value: activity.completed.toLocaleString(), icon: 'check' },
        { label: 'Flagged for review', value: activity.flagged.toLocaleString(), icon: 'filter' },
        { label: 'Failed', value: activity.failed.toLocaleString(), icon: 'close' },
        { label: 'Skipped', value: activity.skipped.toLocaleString(), icon: 'chevron' },
      ]} />
      <section className="panel">
        <PanelHeading title="Tokens and estimated cost" description="USD estimates use model rates. Your provider’s bill may differ." />
        {!models.length ? <p className="panel-body muted">No verification requests recorded in this period.</p> :
          <div className="table-wrap">
            <table className="artist-table ai-usage-table">
              <thead><tr>{['Model', 'Requests', 'Input tokens', 'Output tokens', 'Estimated cost'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>
                {[{ ...usage, provider: '', model: 'Total' }, ...models].map(model => {
                  const knownUsage = model.requests > model.missing_usage;
                  return <tr key={`${model.provider}:${model.model}`}>
                    <td><strong>{model.model}</strong>{model.provider && <small>{providerName(model.provider)}</small>}</td>
                    <td>{model.requests.toLocaleString()}{Boolean(model.missing_usage) && <small>{model.missing_usage.toLocaleString()} without token data</small>}</td>
                    <td>{knownUsage ? model.input_tokens.toLocaleString() : '—'}</td>
                    <td>{knownUsage ? model.output_tokens.toLocaleString() : '—'}</td>
                    <td>{cost(model.estimated_cost_usd)}{Boolean(model.unpriced) && <small>{model.unpriced.toLocaleString()} without pricing</small>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>}
      </section>
      <section className="panel">
        <PanelHeading title="Run history" description="Runs queued in this period. Times are shown in Vilnius time." />
        {!runs.length ? <p className="panel-body muted">No verification runs queued in this period.</p> :
          <div className="table-wrap">
            <table className="artist-table ai-usage-table">
              <thead><tr>{['Run time', 'Trigger', 'Model', 'Events checked', 'Outcome'].map(label => <th key={label} scope="col">{label}</th>)}<th scope="col">Events</th></tr></thead>
              <tbody>
                {runs.map(run => <Fragment key={run.id}>
                  <tr>
                    <td><strong><time dateTime={run.started_at ?? run.queued_at}>{startTime.format(new Date(run.started_at ?? run.queued_at))}</time></strong>
                      <small>{run.started_at ? 'Started' : 'Queued'} · Run #{run.id}</small></td>
                    <td>{run.actor === 'import' ? (run.import_job_id ? `Import #${run.import_job_id}` : 'Import') : 'Manual'}</td>
                    <td>{run.model ?? 'No model configured'}{run.provider && <small>{providerName(run.provider)}</small>}</td>
                    <td>{checked(run).toLocaleString()} / {run.events.toLocaleString()}</td>
                    <td>
                      {run.completed.toLocaleString()} verified
                      {run.flagged > 0 && <small>{run.flagged.toLocaleString()} flagged</small>}
                      {run.failed > 0 && <small>{run.failed.toLocaleString()} failed</small>}
                      {run.skipped > 0 && <small>{run.skipped.toLocaleString()} skipped</small>}
                      {run.pending > 0 && <small>{run.pending.toLocaleString()} pending</small>}
                    </td>
                    <td><button className="secondary-button" type="button" aria-expanded={expanded === run.id} onClick={() => setExpanded(expanded === run.id ? null : run.id)}>
                      {expanded === run.id ? 'Hide events' : 'View events'}
                    </button></td>
                  </tr>
                  {expanded === run.id && <tr><td colSpan={6}><RunEvents id={run.id} /></td></tr>}
                </Fragment>)}
              </tbody>
            </table>
          </div>}
        {report.total > report.limit && <Pagination page={report.page} total={report.total} size={report.limit} onChange={value => { setPage(value); setExpanded(null); }} />}
      </section>
    </>}
  </>;
}
