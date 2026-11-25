import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate, plainText, useJobs, isActive, type EventPage, type EventRow } from './data';
import EventEditor from './event-editor';
import EventItem from './event-item';
import { useEventRowEdits, type EventRowEdits } from './event-row-edits';
import { useSavedEvents } from './saved-events';
import { Feedback, PageHeading, PanelHeading } from './workspace';

type Pair = [EventRow, EventRow];
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('lt').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const todayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' });

function findPairs(events: EventRow[]): Pair[] {
  const byDate = new Map<string, EventRow[]>();
  const pairs: Pair[] = [];
  for (const event of events) {
    if (!event.event_date) continue;
    const title = normalize(event.title);
    if (!title) continue;
    const words = new Set(title.split(' ').filter(word => word.length > 2));
    for (const other of byDate.get(event.event_date) || []) {
      const otherTitle = normalize(other.title);
      const otherWords = new Set(otherTitle.split(' ').filter(word => word.length > 2));
      const shared = [...words].filter(word => otherWords.has(word)).length;
      if (title === otherTitle || (shared >= 2 && shared / Math.max(words.size, otherWords.size) >= 0.6)) pairs.push([other, event]);
    }
    byDate.set(event.event_date, [...(byDate.get(event.event_date) || []), event]);
  }
  return pairs;
}

export default function DuplicatesPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
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
      const rows: EventRow[] = [];
      let page = 1;
      let result: EventPage;
      do {
        result = await api<EventPage>(`/api/events?when=all&source=all&limit=100&page=${page++}`);
        rows.push(...result.events);
      } while (result.events.length && rows.length < result.total);
      if (editsDuringLoad.current === edits) {
        setEvents(rows.map(row => edits.has(row.id) ? { ...row, ...edits.get(row.id) } : row));
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

  const pairs = findPairs(events);
  return <>
    {rowEdits.feedback}
    <PageHeading title="Possible duplicates" description="Events with similar titles on the same date." icon="calendar" />
    <section className="panel">
      <PanelHeading title="Possible duplicate events" end={!loading && <span className="count-label">{pairs.length} pairs</span>} />
      <div className="catalogue-feedback"><Feedback message={error} error /></div>
      {loading && <p className="empty-state" role="status">Looking for possible duplicates…</p>}
      {!loading && !error && !pairs.length && <p className="empty-state">No possible duplicates found.</p>}
      {!loading && pairs.map(([first, second]) => <section className="duplicate-pair" key={`${first.id}-${second.id}`}>
        <h3>Possible match · {formatDate(first.event_date!)}</h3>
        <div className="event-list">{[first, second].map(row => {
          const key = `${first.id}-${second.id}-${row.id}`;
          return <EventItem key={key} row={row} today={today} open={openKey === key} toggle={() => setOpenKey(current => current === key ? '' : key)}
            selected={false} select={() => {}} selectionEnabled={false} disabled={savedLoading}
            pendingEdit={rowEdits.pending.get(row.id)} bookmarkPending={pendingIds.includes(row.id)} confirmPending={pendingId === row.id}
            review={status => void rowEdits.save(row.id, { review_status: status })}
            confirm={() => void confirmAssistantReview(row.id)}
            changeInterestScore={score => void rowEdits.save(row.id, { interest_score: score })}
            showSource saved={isSaved(row.id)} toggleSaved={() => void toggle(row)}
            editor={<EventEditor row={row} onSaved={() => load(true)} onRefresh={() => void refreshSource(row)} refreshing={refreshing} />} />;
        })}</div>
      </section>)}
    </section>
  </>;
}
