import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, publicationLabels, type EventRow } from './data';
import { Disclosure, Feedback } from './workspace';

export const verificationLabels = {
  not_verified: 'Not verified', queued: 'Verification queued', verifying: 'Verifying',
  verified: 'AI verified', stale: 'Recheck needed', failed: 'Verification failed',
};
const fieldLabels: Record<string, string> = {
  title: 'Title', description: 'Description', event_date: 'Date', event_end_date: 'End date', event_time: 'Time', venue: 'Venue', city: 'City',
  ticket_url: 'Ticket link', about_url: 'Original event link', source_url: 'Source link', price_text: 'Price', price_type: 'Price type',
  artists: 'Performers', review_status: 'Music classification', duplicate: 'Possible duplicate', cancellation: 'Event status', image: 'Image', event: 'Event',
};
const editable = new Set(['title', 'description', 'event_date', 'event_end_date', 'event_time', 'venue', 'city', 'ticket_url', 'about_url', 'price_type', 'price_text', 'artists', 'review_status']);
const historyLabels: Record<string, string> = {
  imported: 'Imported', source_refreshed: 'Source refreshed', details_refreshed: 'Source details refreshed', verified: 'AI verification completed',
  verification_failed: 'Verification failed', published: 'Published in Dracula', unpublished: 'Unpublished from Dracula',
  publication_confirmed: 'Publication status confirmed', publication_migrated: 'Existing public event carried forward',
  manual_edit: 'Event edited', price_changed: 'Price changed', artist_changed: 'Artist decision changed', classification_changed: 'Music classification changed',
  finding_approved: 'Finding approved', finding_dismissed: 'Finding dismissed', edit_proposed: 'Edit proposed', assistant_review_confirmed: 'Assistant review checked',
};

export type Profile = { id: number; name: string; provider: 'gemini' | 'openai'; model: string };
export type ProfilesResponse = { profiles: Profile[]; default_id: number | null; configured: boolean };
type Finding = { id: number; field: string; current: unknown; proposed: string; evidence: string; reason: string };
type HistoryEntry = { id: number; action: string; actor: string; occurred_at: string; changes: Record<string, { before: unknown; after: unknown }>; context: { model?: string; evidence?: string | Record<string, string>; error?: string } };
type Verification = {
  revision: number; publication_status: 'live' | 'draft'; verification_status: keyof typeof verificationLabels; needs_attention: number;
  findings: Finding[]; log: HistoryEntry[]; next_before: number | null;
  last_run: { id: number; job_id: number; status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped'; model: string | null; error_message: string | null; result: { fields?: Record<string, string> } | null } | null;
};
type QueuedVerification = { id: number; queued?: number };
type Job = { id: number; model: string | null; import_job_id: number | null; total: number; queued: number; running: number; completed: number; failed: number; skipped: number; flagged: number; error_message: string | null };

const workflow = '/api/workflow';
const fieldName = (field: string) => fieldLabels[field] ?? field.replaceAll('_', ' ');
const display = (value: unknown) => value === null || value === undefined || value === '' ? 'Unknown' : typeof value === 'string' ? value : JSON.stringify(value);
const logDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vilnius' });

export function EventBadges({ row }: { row: Pick<EventRow, 'publication_status' | 'verification_status' | 'needs_attention'> }) {
  const verificationStatus = row.verification_status ?? 'not_verified';
  const publicationStatus = row.publication_status ?? 'draft';
  return <div className="event-badges">
    <span className={publicationStatus === 'live' ? 'event-badge event-badge-live' : 'event-badge'}>{publicationLabels[publicationStatus]}</span>
    <span className={verificationStatus === 'verified' ? 'event-badge event-badge-verified' : 'event-badge'}>{verificationLabels[verificationStatus]}</span>
    {Boolean(row.needs_attention) && <span className="event-badge event-badge-attention">Needs attention</span>}
  </div>;
}

export function VerificationRequest({ eventIds, onQueued, inline = false, pending }: {
  eventIds: number[]; onQueued: (job: QueuedVerification) => void | Promise<void>; inline?: boolean; pending?: 'queued' | 'verifying';
}) {
  const [profiles, setProfiles] = useState<ProfilesResponse | null>(null);
  const [profile, setProfile] = useState('');
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const request = useRef<{ options: string; key: string } | null>(null);
  const active = Boolean(pending);

  const load = useCallback(async () => {
    try { setProfiles(await api<ProfilesResponse>(workflow + '/providers')); setError(false); setMessage(''); }
    catch (cause) { setError(true); setMessage(errorMessage(cause)); }
  }, []);
  useEffect(() => { if (inline) void load(); }, [inline, load]);

  async function run() {
    setBusy(true);
    setError(false);
    setMessage('');
    const payload = { event_ids: eventIds, ...(profile ? { profile_id: Number(profile) } : {}), allow_publish: publish };
    const options = JSON.stringify(payload);
    if (request.current?.options !== options) request.current = { options, key: crypto.randomUUID() };
    try {
      const result = await api<QueuedVerification>(workflow + '/verification/jobs', { ...payload, request_key: request.current.key });
      if (!inline) setMessage(result.queued === 0 ? 'These events are already queued.' : `Verification job #${result.id} queued.`);
      request.current = null;
      await onQueued(result);
    } catch (cause) { setError(true); setMessage(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  const controls = <div className="stack" onFocus={() => { if (!inline && !profiles && !error) void load(); }}>
    {profiles && (!profiles.configured || !profiles.profiles.length) && <p className="muted">Add an AI provider in <a href="/settings.html">Settings</a> to start verification.</p>}
    <div className={inline ? 'publication-controls' : 'stack'}>
      {!profiles && (!inline || error) && <button className="secondary-button" type="button" onClick={() => void load()}>Load AI models</button>}
      {!!profiles?.profiles.length && <label className="field">AI model
        <select value={profile} onChange={event => setProfile(event.target.value)} disabled={busy || active}>
          <option value="">Default model</option>
          {profiles.profiles.map(item => <option value={item.id} key={item.id}>{item.name} · {item.model}</option>)}
        </select>
      </label>}
      <button className="primary-button" type="button" disabled={busy || active || !profiles?.configured || !profiles.profiles.length || (!profile && !profiles.default_id) || eventIds.length > 200} onClick={() => void run()}>
        {pending === 'verifying' ? 'Evaluating…' : pending === 'queued' ? 'Queued…' : busy ? 'Queueing…' : inline ? 'Evaluate' : 'Start verification'}
      </button>
    </div>
    <label className="checkbox-label"><input type="checkbox" checked={publish} onChange={event => setPublish(event.target.checked)} disabled={busy || active} /> Publish clear music events after verification</label>
    {eventIds.length > 200 && <p>Select at most 200 events per verification run.</p>}
    {message && <Feedback message={message} error={error} />}
  </div>;
  return inline ? controls : <Disclosure title={eventIds.length > 1 ? 'Verify selected with AI' : 'Verify with AI'}>{controls}</Disclosure>;
}

export function useVerificationJobs(onChange: () => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const signature = useRef('');
  const callback = useRef(onChange);
  useEffect(() => { callback.current = onChange; }, [onChange]);
  const load = useCallback(async () => {
    try {
      const result = await api<{ jobs: Job[] }>(workflow + '/verification/jobs');
      const key = JSON.stringify(result.jobs);
      if (signature.current && signature.current !== key) { callback.current(); window.dispatchEvent(new Event('seeker:attention-changed')); }
      signature.current = key;
      setJobs(result.jobs);
    } catch { /* The next status poll can retry. */ }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [load]);
  return { jobs, load };
}

export function VerificationJobs({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return null;
  return <Disclosure title="Recent verification jobs">
    <ul className="verification-jobs">{jobs.map(job => <li key={job.id}>
      <strong>#{job.id} · {job.model ?? 'No model configured'}</strong>
      <span>{job.import_job_id ? `Import #${job.import_job_id} · ` : ''}{job.completed} of {job.total} verified{job.flagged ? ` · ${job.flagged} need attention` : ''}{job.failed ? ` · ${job.failed} failed` : ''}{job.skipped ? ` · ${job.skipped} skipped` : ''}{job.running || job.queued ? ` · ${Number(job.running) + Number(job.queued)} pending` : ''}</span>
      {job.error_message && <small>{job.error_message}</small>}
    </li>)}</ul>
  </Disclosure>;
}

export function EventVerification({ row, onSaved }: { row: EventRow; onSaved: () => void | Promise<void> }) {
  const [data, setData] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [loadError, setLoadError] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [requestedJob, setRequestedJob] = useState<{ id?: number } | null>(null);
  const [requestedHere, setRequestedHere] = useState(false);
  const loadSequence = useRef(0);
  const path = `${workflow}/events/${row.id}`;
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const result = await api<Verification>(path + '/verification');
      if (sequence !== loadSequence.current) return;
      setData(result);
      setLoadError('');
      setRequestedJob(current => current && (current.id === undefined || Number(result.last_run?.job_id) >= current.id) ? null : current);
    } catch (cause) {
      if (sequence === loadSequence.current) setLoadError(errorMessage(cause));
    }
  }, [path]);
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [load, row.revision, row.publication_status, row.verification_status, row.needs_attention]);
  const saveCallback = useRef(onSaved);
  const observedRun = useRef('');
  useEffect(() => { saveCallback.current = onSaved; }, [onSaved]);
  const status = data?.verification_status ?? row.verification_status;
  const run = data?.last_run;
  const pending = status === 'verifying' || run?.status === 'running' ? 'verifying'
    : requestedJob !== null || status === 'queued' || run?.status === 'queued' ? 'queued' : undefined;
  const active = Boolean(pending);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: number;
    async function poll() {
      await load();
      if (!disposed) timer = window.setTimeout(poll, 2000);
    }
    timer = window.setTimeout(poll, 2000);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [active, load]);
  useEffect(() => {
    if (!data) return;
    const runKey = run ? `${run.id}:${run.status}` : 'none';
    const finished = run?.status === 'completed' || run?.status === 'failed' || run?.status === 'skipped';
    const newResult = finished && observedRun.current !== runKey && (requestedHere || Boolean(observedRun.current));
    observedRun.current = runKey;
    if (newResult || data.revision !== row.revision || data.verification_status !== (row.verification_status ?? 'not_verified')
        || Boolean(data.needs_attention) !== Boolean(row.needs_attention) || data.publication_status !== row.publication_status) {
      void Promise.resolve(saveCallback.current()).catch(() => undefined);
      if (finished) window.dispatchEvent(new Event('seeker:attention-changed'));
    }
  }, [data?.verification_status, data?.revision, data?.needs_attention, data?.publication_status, run?.id, run?.status, requestedHere, row.revision, row.verification_status, row.needs_attention, row.publication_status]);

  function onQueued(job: QueuedVerification) {
    setRequestedHere(true);
    // Empty and replayed jobs can refer to an event already being checked by another job.
    setRequestedJob(job.queued === 1 ? { id: job.id } : {});
    return load();
  }

  async function update(url: string, value: Record<string, unknown>) {
    if (!data) return;
    setBusy(true);
    setFailure('');
    try {
      await api(url, { ...value, revision: data.revision });
      await onSaved();
      window.dispatchEvent(new Event('seeker:attention-changed'));
    } catch (cause) { setFailure(errorMessage(cause)); }
    finally { await load(); setBusy(false); }
  }

  async function olderLog() {
    if (!data?.next_before) return;
    try {
      const older = await api<Verification>(path + '/verification?before=' + data.next_before);
      setData(current => current ? { ...current, log: [...current.log, ...older.log], next_before: older.next_before } : current);
    } catch (cause) { setFailure(errorMessage(cause)); }
  }

  return <section className="verification-section stack" aria-label="Publication and verification">
    <div className="publication-controls">
      <EventBadges row={pending ? { ...(data ?? row), verification_status: pending } : data ?? row} />
      {data && <button className="secondary-button" type="button" disabled={busy} onClick={() => void update(path + '/publication', { status: data.publication_status === 'live' ? 'draft' : 'live' })}>
        {data.publication_status === 'live' ? 'Unpublish' : 'Publish in Dracula'}
      </button>}
    </div>
    <VerificationRequest eventIds={[row.id]} onQueued={onQueued} inline pending={pending} />
    {active && <Feedback message={pending === 'queued' ? 'Verification queued.' : 'AI verification in progress…'} />}
    {!active && requestedHere && run?.status === 'completed' && <Feedback message={data?.needs_attention ? 'Verification complete. Review the findings below.' : 'Verification complete.'} />}
    {!active && run?.error_message && <Feedback message={run.error_message} error />}
    {data?.findings.length ? <div className="stack">
      <h4>Needs attention</h4>
      {data.findings.map(finding => <article className="verification-finding stack" key={finding.id}>
        <strong>{fieldName(finding.field)}</strong>
        <p>{finding.reason}</p>
        <p>Current value · {display(finding.current)}</p>
        {finding.evidence && <blockquote>{finding.evidence}</blockquote>}
        {editable.has(finding.field) && <label className="field">Proposed value
          <input value={drafts[finding.id] ?? finding.proposed} onChange={event => setDrafts(current => ({ ...current, [finding.id]: event.target.value }))} disabled={busy} />
        </label>}
        <div className="publication-controls">
          {editable.has(finding.field) && <button className="primary-button" type="button" disabled={busy || !(drafts[finding.id] ?? finding.proposed).trim()} onClick={() => void update(`${path}/findings/${finding.id}`, { decision: 'approve', value: drafts[finding.id] ?? finding.proposed })}>{drafts[finding.id] !== undefined && drafts[finding.id] !== finding.proposed ? 'Edit and approve' : 'Approve'}</button>}
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void update(`${path}/findings/${finding.id}`, { decision: 'dismiss' })}>Dismiss</button>
        </div>
      </article>)}
    </div> : null}
    {data?.last_run?.result?.fields && <Disclosure title="Fields checked">
      <dl className="verification-fields">{Object.entries(data.last_run.result.fields).map(([field, status]) => <div key={field}><dt>{fieldName(field)}</dt><dd>{status.replaceAll('_', ' ')}</dd></div>)}</dl>
    </Disclosure>}
    <Disclosure title="Event log">
      {!data?.log.length ? <p className="muted">No event history recorded.</p> : <ol className="verification-log">{data.log.map(entry => <li key={entry.id}>
        <strong>{historyLabels[entry.action] ?? fieldName(entry.action)}</strong>
        <span>{logDate.format(new Date(entry.occurred_at))} · {entry.actor}</span>
        {entry.context.error && <p>{entry.context.error}</p>}
        {typeof entry.context.evidence === 'string' && entry.context.evidence && <blockquote>{entry.context.evidence}</blockquote>}
        {Object.keys(entry.changes).length > 0 && <ul>{Object.entries(entry.changes).map(([field, value]) => <li key={field}>
          {fieldName(field)} · {display(value.before)} → {display(value.after)}
          {typeof entry.context.evidence === 'object' && entry.context.evidence[field] && <blockquote>{entry.context.evidence[field]}</blockquote>}
        </li>)}</ul>}
      </li>)}</ol>}
      {data?.next_before && <button className="secondary-button" type="button" onClick={() => void olderLog()}>Load older entries</button>}
    </Disclosure>
    <Feedback message={failure || loadError} error />
  </section>;
}
