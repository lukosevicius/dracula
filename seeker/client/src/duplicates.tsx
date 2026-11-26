import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate, plainText, useJobs, isActive, type EventPage, type EventRow } from './data';
import EventEditor from './event-editor';
import EventItem from './event-item';
import { useEventRowEdits, type EventRowEdits } from './event-row-edits';
import { useSavedEvents } from './saved-events';
import { Feedback, PageHeading, PanelHeading } from './workspace';

type ServerPair = { level: 'confident' | 'likely'; mergeable: boolean; event_ids: [number, number] };
type Pair = ServerPair & { events: [EventRow, EventRow] };
const workflow = '/api/workflow/duplicates';
const todayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' });

export default function DuplicatesPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [serverPairs, setServerPairs] = useState<ServerPair[]>([]);
  const [merging, setMerging] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [openKey, setOpenKey] = useState('');
  const editsDuringLoad = useRef<Map<number, EventRowEdits> | null>(null);
  const { isSaved, toggle, update, refresh, pendingIds, loading: savedLoading } = useSavedEvents();
  const { jobs, start, startingSource } = useJobs(() => {});
  const refreshing = startingSource !== null || jobs.some(job => ['avilys', 'vilnius-events'].includes(job.source) && isActive(job));
  const today = todayFormatter.format(new Date());
  const rowEdits = useEventRowEdits((id, patch) => {
    const loadingEdits = editsDuringLoad.current;
    loadingEdits?.set(id, { ...loadingEdits.get(id), ...patch });
    setEvents(current => current.map(event => event.id === id ? { ...event, ...patch } : event));
    update(id, patch);
    if (isSaved(id) || pendingIds.includes(id)) void refresh(id);
  });

  const load = useCallback(async (silent = false) => {
    const edits = new Map<number, EventRowEdits>();
    editsDuringLoad.current = edits;
    if (!silent) setLoading(true);
    setError('');
    try {
      const found = api<{ pairs: ServerPair[] }>(workflow);
      const rows: EventRow[] = [];
      let page = 1;
      let result: EventPage;
      do {
        result = await api<EventPage>(`/api/events?when=all&source=all&limit=100&page=${page++}`);
        rows.push(...result.events);
      } while (result.events.length && rows.length < result.total);
      const { pairs: duplicatePairs } = await found;
      if (editsDuringLoad.current === edits) {
        setEvents(rows.map(row => edits.has(row.id) ? { ...row, ...edits.get(row.id) } : row));
        setServerPairs(duplicatePairs);
      }
    } catch (cause) {
      if (editsDuringLoad.current === edits) setError(errorMessage(cause));
    } finally {
      if (editsDuringLoad.current === edits) {
        editsDuringLoad.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function confirmAssistantReview(id: number) {
    setPendingId(id);
    setError('');
    try {
      await api(`/api/events/${id}/confirm-assistant-review`, {});
      await Promise.all([load(true), isSaved(id) ? refresh(id) : undefined]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setPendingId(null); }
  }

  async function refreshSource(row: EventRow) {
    try { await start('vilnius-events', 'details-event', { event_id: row.id }); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  async function act(key: string, path: string, body: unknown, success: (result: Record<string, unknown>) => string) {
    setMerging(key);
    setError('');
    setNotice('');
    try {
      const result = await api<Record<string, unknown>>(`${workflow}/${path}`, body);
      setNotice(success(result));
      await load(true);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setMerging(''); }
  }

  const byId = new Map(events.map(event => [event.id, event]));
  const pairs: Pair[] = serverPairs.flatMap(pair => {
    const [first, second] = pair.event_ids.map(id => byId.get(id));
    return first && second ? [{ ...pair, events: [first, second] as [EventRow, EventRow] }] : [];
  });
  const confident = pairs.filter(pair => pair.level === 'confident' && pair.mergeable).length;
  return <>
    {rowEdits.feedback}
    <PageHeading title="Possible duplicates" description="Upcoming events that look like the same performance. Merging keeps one event with every source listing; the other event's link redirects to it." icon="calendar" />
    <section className="panel">
      <PanelHeading title="Possible duplicate events" end={!loading && <span className="duplicate-actions">
        <span className="count-label">{pairs.length} pairs</span>
        {confident > 0 && <button className="primary-button" type="button" disabled={Boolean(merging)}
          onClick={() => void act('all', 'merge-confident', {}, result => `Merged ${(result.merged as unknown[]).length} events.${(result.skipped as unknown[]).length ? ` ${(result.skipped as unknown[]).length} could not be merged.` : ''}`)}>
          {merging === 'all' ? 'Merging…' : `Merge ${confident} confident`}
        </button>}
      </span>} />
      <div className="catalogue-feedback"><Feedback message={error} error /><Feedback message={notice} /></div>
      {loading && <p className="empty-state" role="status">Looking for possible duplicates…</p>}
      {!loading && !error && !pairs.length && <p className="empty-state">No possible duplicates found.</p>}
      {!loading && pairs.map(pair => {
        const [first, second] = pair.events, key = `${first.id}-${second.id}`;
        return <section className="duplicate-pair" key={key}>
        <div className="duplicate-pair-heading">
          <h3>{pair.level === 'confident' ? 'Confident match' : 'Likely match'} · {formatDate(first.event_date!)}</h3>
          <div className="duplicate-pair-actions">
            {pair.mergeable
              ? <button className="secondary-button" type="button" disabled={Boolean(merging)}
                  onClick={() => void act(key, 'merge', { event_ids: [first.id, second.id] }, result => `Merged #${result.merged_event_id} into #${result.event_id}.`)}>
                  {merging === key ? 'Merging…' : 'Merge'}
                </button>
              : <span className="duplicate-note">Same source listed twice. Unpublish the extra listing.</span>}
            <button className="text-button" type="button" disabled={Boolean(merging)}
              onClick={() => void act(`${key}-distinct`, 'dismiss', { event_ids: [first.id, second.id] }, () => 'Marked as different events.')}>Not a duplicate</button>
          </div>
        </div>
        <div className="event-list">{[first, second].map(row => {
          const key = `${first.id}-${second.id}-${row.id}`;
          return <EventItem key={key} row={row} today={today} open={openKey === key} toggle={() => setOpenKey(current => current === key ? '' : key)}
            selected={false} select={() => {}} selectionEnabled={false} disabled={savedLoading}
            pendingEdit={rowEdits.pending.get(row.id)} bookmarkPending={pendingIds.includes(row.id)} confirmPending={pendingId === row.id}
            changePublication={status => void rowEdits.save(row.id, { publication_status: status }, row.revision)}
            review={status => void rowEdits.save(row.id, { review_status: status })}
            confirm={() => void confirmAssistantReview(row.id)}
            changeInterestScore={score => void rowEdits.save(row.id, { interest_score: score })}
            showSource saved={isSaved(row.id)} toggleSaved={() => void toggle(row)}
            editor={<EventEditor row={row} onSaved={() => load(true)} onRefresh={() => void refreshSource(row)} refreshing={refreshing} />} />;
        })}</div>
      </section>;
      })}
    </section>
  </>;
}
