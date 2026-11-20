import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { readSaved, writeSaved } from './saved-storage';
import type { DisplayEvent } from './events-api';

type SavedContext = { events: DisplayEvent[]; toggle: (event: DisplayEvent) => void; error: boolean };
const Context = createContext<SavedContext>({ events: [], toggle: () => {}, error: false });
export function SavedEventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    function load() { try { const value = JSON.parse(readSaved()); setEvents(Array.isArray(value) ? value : []); setError(false); } catch { setError(true); } }
    load();
    if (typeof window !== 'undefined') { window.addEventListener('storage', load); return () => window.removeEventListener('storage', load); }
  }, []);
  function toggle(event: DisplayEvent) {
    const next = events.some(item => item.id === event.id) ? events.filter(item => item.id !== event.id) : [event, ...events];
    try { writeSaved(JSON.stringify(next)); setEvents(next); setError(false); } catch { setError(true); }
  }
  return <Context value={{ events, toggle, error }}>{children}</Context>;
}
export function useSavedEvents() { return use(Context); }
