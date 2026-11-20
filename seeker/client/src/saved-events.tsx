import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { formatDate, priceInfo, safeUrl, sourceNames, type EventRow } from './data';
import { Icon, PageHeading, PanelHeading } from './workspace';

const storageKey = 'seeker-saved-events';
type SavedEventsContextValue = { events: EventRow[]; isSaved: (id: number) => boolean; toggle: (event: EventRow) => void };
const SavedEventsContext = createContext<SavedEventsContextValue>({ events: [], isSaved: () => false, toggle: () => {} });

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

  return <SavedEventsContext.Provider value={{ events, isSaved: id => events.some(event => event.id === id), toggle }}>{children}</SavedEventsContext.Provider>;
}

export function useSavedEvents() { return useContext(SavedEventsContext); }

const dateFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const vilniusDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' });

export function SavedEventsPage() {
  const { events, toggle } = useSavedEvents();
  return <>
    <PageHeading title="Saved events" description="Events you bookmarked in Seeker." icon="save" />
    <section className="panel saved-events-panel">
      <PanelHeading title="Your saved events" end={<span className="count-label">{events.length} saved</span>} />
      <div className="saved-event-list">
        {events.map(event => {
          const date = event.event_date ? formatDate(event.event_date) : 'Date unknown';
          const price = priceInfo(event);
          const publicEvent = event.review_status === 'music' && (!event.event_date || (event.event_end_date || event.event_date) >= vilniusDateFormatter.format(new Date()));
          const sourceUrl = safeUrl(event.about_url) || safeUrl(event.source_url);
          return <article className="saved-event" key={event.id}>
            <div className="saved-event-date"><span>{event.event_date ? dateFormatter.format(new Date(`${event.event_date}T12:00:00Z`)) : 'Date'}</span><strong>{event.event_date?.slice(8, 10) || '—'}</strong></div>
            <div className="saved-event-copy">
              <strong>{event.title}</strong>
              <span>{date}{event.event_time ? ` · ${event.event_time.slice(0, 5)}` : ''}{event.venue ? ` · ${event.venue}` : ''}</span>
              {(price.text || price.type !== 'unknown') && <small>{price.text || (price.type === 'free' ? 'Free' : 'Paid')}</small>}
              <div className="saved-event-links">
                {publicEvent && <a href={`https://app.dracula.lt/events/${event.id}`} target="_blank" rel="noreferrer">View in Dracula <Icon name="external" size={13} /></a>}
                {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">{sourceNames[event.source_key] || 'Original event'} <Icon name="external" size={13} /></a>}
              </div>
            </div>
            <button className="icon-button save-event-button" type="button" aria-label={`Remove ${event.title} from saved events`} title="Remove from saved events" aria-pressed="true" onClick={() => toggle(event)}><Icon name="save" /></button>
          </article>;
        })}
        {!events.length && <p className="empty-state">No saved events yet. Use the save button on an event to add it here.</p>}
      </div>
    </section>
  </>;
}
