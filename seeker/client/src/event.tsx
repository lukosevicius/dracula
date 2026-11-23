import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, useJobs, type EventRow } from './data';
import EventEditor from './event-editor';
import { Feedback, Icon, PageHeading } from './workspace';

export default function EventPage({ id }: { id: string }) {
  const [row, setRow] = useState<EventRow | null>(null);
  const [error, setError] = useState('');
  const valid = /^[1-9]\d{0,11}$/.test(id);
  const load = useCallback(async () => {
    try {
      const result = await api<{ row: EventRow }>(`/api/events/${id}/details`);
      setRow(result.row);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    }
  }, [id]);
  const { jobs, start, startingSource } = useJobs(() => { void load().catch(() => {}); });
  useEffect(() => { if (valid) void load().catch(() => {}); }, [load, valid]);
  const refreshing = startingSource === 'vilnius-events' || jobs.some(job => job.source === 'vilnius-events' && ['queued', 'running'].includes(job.status));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  return <div className="main-stack">
    <div><a className="secondary-button" href="/all-events.html"><Icon name="left" size={14} /> All events</a></div>
    {!valid ? <Feedback message="Invalid event ID." error /> : !row && error ? <div><Feedback message={error} error /><button className="secondary-button" type="button" onClick={() => void load().catch(() => {})}>Retry</button></div> : !row ? <p className="empty-state" role="status">Loading event…</p> : <>
      <PageHeading title={row.title} description={`Event #${id}`} icon="calendar" />
      {error && <Feedback message={error} error />}
      <section className="panel"><div className="panel-body">
        <EventEditor row={row} today={today} onSaved={load} refreshing={refreshing} onRefresh={() => { void start('vilnius-events', 'details-event', { pages: 1, event_id: row.id }).catch(cause => setError(errorMessage(cause))); }} />
      </div></section>
    </>}
  </div>;
}
