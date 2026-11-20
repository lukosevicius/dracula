import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ReviewStatus } from '../../types';
import { api, errorMessage, isActive, plainText, type EventPage, type EventRow, useJobs } from './data';
import EventEditor from './event-editor';
import EventItem from './event-item';
import { Feedback, PageHeading, PanelHeading } from './workspace';

const storageKey = 'seeker-saved-events';
type SavedEventsContextValue = { events: EventRow[]; isSaved: (id: number) => boolean; toggle: (event: EventRow) => void; update: (event: EventRow) => void };
const SavedEventsContext = createContext<SavedEventsContextValue>({ events: [], isSaved: () => false, toggle: () => {}, update: () => {} });

function readSavedEvents(): EventRow[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? value.filter(item => item && Number.isSafeInteger(item.id) && typeof item.title === 'string') : [];
  } catch {
    return [];
  }
}

export function SavedEventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<EventRow[]>(readSavedEvents);
  useEffect(() => {
    const sync = () => setEvents(readSavedEvents());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  function toggle(event: EventRow) {
    setEvents(current => {
      const next = current.some(item => item.id === event.id)
        ? current.filter(item => item.id !== event.id)
        : [event, ...current];
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* keep the current session usable */ }
      return next;
    });
  }

  function update(event: EventRow) {
    setEvents(current => {
      if (!current.some(item => item.id === event.id)) return current;
      const next = current.map(item => item.id === event.id ? event : item);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* keep the current session usable */ }
      return next;
    });
  }

  return <SavedEventsContext.Provider value={{ events, isSaved: id => events.some(event => event.id === id), toggle, update }}>{children}</SavedEventsContext.Provider>;
}

export function useSavedEvents() { return useContext(SavedEventsContext); }

const vilniusDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' });

export function SavedEventsPage() {
  const { events, isSaved, toggle, update } = useSavedEvents();
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
      <div className="catalogue-feedback"><Feedback message={notice} error={noticeError} /></div>
      <div className="saved-event-list">
        {events.map(event => <EventItem key={event.id} row={event} today={today} open={openId === event.id} toggle={() => setOpenId(current => current === event.id ? null : event.id)}
          selected={false} select={() => {}} disabled={pendingId === event.id || refreshing} review={status => void saveReview(event, status)}
          confirm={() => void confirmAssistantReview(event)} showSource saved={isSaved(event.id)} toggleSaved={() => toggle(event)} selectionEnabled={false}
          editor={<EventEditor row={event} today={today} onSaved={() => refreshSavedRow(event)} onRefresh={() => void refreshSourceDetails(event)} refreshing={refreshing} />} />)}
        {!events.length && <p className="empty-state">No saved events yet. Use the save button on an event to add it here.</p>}
      </div>
    </section>
  </>;
}
