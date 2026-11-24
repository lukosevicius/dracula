import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ReviewStatus } from '../../types';
import { api, errorMessage, isActive, plainText, type EventPage, type EventRow, useJobs } from './data';
import EventEditor from './event-editor';
import EventItem from './event-item';
import { Feedback, PageHeading, PanelHeading } from './workspace';

const storageKey = 'seeker-saved-events';
type SavedEventsContextValue = { events: EventRow[]; isSaved: (id: number) => boolean; toggle: (event: EventRow) => Promise<void>; update: (event: EventRow) => void; loading: boolean; error: string; pendingIds: number[] };
const SavedEventsContext = createContext<SavedEventsContextValue>({ events: [], isSaved: () => false, toggle: async () => {}, update: () => {}, loading: true, error: '', pendingIds: [] });

function readLegacySavedIds(): number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(item => item && Number.isSafeInteger(item.id) && item.id > 0).map(item => Number(item.id)))] : [];
  } catch {
    return [];
  }
}

export function SavedEventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const legacyIds = readLegacySavedIds();
        if (legacyIds.length) {
          for (let index = 0; index < legacyIds.length; index += 500) await api('/api/saved-events', { ids: legacyIds.slice(index, index + 500) });
          localStorage.removeItem(storageKey);
        }
        const result = await api<{ events: EventRow[] }>('/api/saved-events');
        if (active) setEvents(result.events);
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function toggle(event: EventRow) {
    if (loading || pendingIds.includes(event.id)) return;
    const removing = events.some(item => item.id === event.id);
    setPendingIds(current => [...current, event.id]);
    setError('');
    try {
      await api(removing ? '/api/saved-events/remove' : '/api/saved-events', removing ? { id: event.id } : { ids: [event.id] });
      setEvents(current => removing ? current.filter(item => item.id !== event.id) : [event, ...current]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPendingIds(current => current.filter(id => id !== event.id));
    }
  }

  function update(event: EventRow) {
    setEvents(current => current.map(item => item.id === event.id ? event : item));
  }

  return <SavedEventsContext.Provider value={{ events, isSaved: id => events.some(event => event.id === id), toggle, update, loading, error, pendingIds }}>{children}</SavedEventsContext.Provider>;
}

export function useSavedEvents() { return useContext(SavedEventsContext); }

const vilniusDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' });

export function SavedEventsPage() {
  const { events, isSaved, toggle, update, loading, error, pendingIds } = useSavedEvents();
  const [openId, setOpenId] = useState<number | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const today = vilniusDateFormatter.format(new Date());
  const { jobs, start, startingSource } = useJobs(() => {});
  const refreshing = startingSource !== null || jobs.some(job => ['avilys', 'vilnius-events'].includes(job.source) && isActive(job));

  async function refreshSavedRow(row: EventRow) {
    try {
      const params = new URLSearchParams({ page: '1', limit: '100', when: 'all', search: plainText(row.title), source: row.source_key });
      const result = await api<EventPage>(`/api/events?${params}`);
      const current = result.events.find(event => event.id === row.id);
      if (current) update(current);
    } catch {
      // The editor already reports a successful save; keep the saved copy usable if refresh fails.
    }
  }

  async function saveReview(row: EventRow, status: ReviewStatus) {
    setPendingId(row.id);
    try {
      await api(`/api/events/${row.id}/review`, { review_status: status });
      await refreshSavedRow({ ...row, review_status: status });
    } catch (error) {
      setNoticeError(true);
      setNotice(errorMessage(error));
    } finally {
      setPendingId(null);
    }
  }

  async function confirmAssistantReview(row: EventRow) {
    setPendingId(row.id);
    try {
      await api(`/api/events/${row.id}/confirm-assistant-review`, {});
      await refreshSavedRow(row);
    } catch (error) {
      setNoticeError(true);
      setNotice(errorMessage(error));
    } finally {
      setPendingId(null);
    }
  }

  async function changeInterestScore(row: EventRow, score: 1 | 2 | 3 | 4 | 5) {
    setPendingId(row.id);
    setNoticeError(false);
    setNotice('');
    try {
      await api(`/api/events/${row.id}/interest-score`, { interest_score: score });
      update({ ...row, interest_score: score });
      setNotice('Interest score saved.');
    } catch (cause) {
      setNoticeError(true);
      setNotice(errorMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  async function refreshSourceDetails(row: EventRow) {
    setNoticeError(false);
    setNotice('');
    try { await start('vilnius-events', 'details-event', { event_id: row.id }); }
    catch (error) { setNoticeError(true); setNotice(errorMessage(error)); }
  }

  return <>
    <PageHeading title="Saved events" description="Events you bookmarked in Seeker." icon="save" />
    <section className="panel saved-events-panel">
      <PanelHeading title="Your saved events" end={<span className="count-label">{events.length} saved</span>} />
      {error && <div className="catalogue-feedback"><Feedback message={error} error /></div>}
      <div className="catalogue-feedback"><Feedback message={notice} error={noticeError} /></div>
      <div className="saved-event-list">
        {loading && <p className="empty-state" role="status">Loading saved events…</p>}
        {events.map(event => <EventItem key={event.id} row={event} today={today} open={openId === event.id} toggle={() => setOpenId(current => current === event.id ? null : event.id)}
          selected={false} select={() => {}} disabled={loading || pendingIds.includes(event.id) || pendingId === event.id || refreshing} review={status => void saveReview(event, status)}
          changeInterestScore={score => void changeInterestScore(event, score)}
          confirm={() => void confirmAssistantReview(event)} showSource saved={isSaved(event.id)} toggleSaved={() => toggle(event)} selectionEnabled={false}
          editor={<EventEditor row={event} onSaved={() => refreshSavedRow(event)} onRefresh={() => void refreshSourceDetails(event)} refreshing={refreshing} />} />)}
        {!loading && !error && !events.length && <p className="empty-state">No saved events yet. Use the save button on an event to add it here.</p>}
      </div>
    </section>
  </>;
}
