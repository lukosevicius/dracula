import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/auth-context';
import { apiUrl, type DisplayEvent } from './events-api';
import { readSaved, writeSaved } from './saved-storage';

type SavedContext = { events: DisplayEvent[]; toggle: (event: DisplayEvent) => void; error: boolean; loading: boolean; retry: () => void };
const Context = createContext<SavedContext>({ events: [], toggle: () => {}, error: false, loading: true, retry: () => {} });
async function accountRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}/v1/me/saved-events${path}`, { ...init, credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`Saved events request failed (${response.status})`);
  return response.json();
}
function guestEvents(): DisplayEvent[] {
  const value = JSON.parse(readSaved());
  if (!Array.isArray(value)) throw new Error('Invalid saved events');
  return value;
}
export function SavedEventsProvider({ children }: { children: ReactNode }) {
  const { state, user } = useAuth();
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    busy.current = true; setLoading(true); setError(false); setEvents([]);
    if (state === 'loading') return;
    async function load() {
      try {
        const guest = guestEvents();
        if (state === 'signed-in' && user) {
          for (let i = 0; i < guest.length; i += 500) {
            await accountRequest('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: guest.slice(i, i + 500).map(event => event.id) }) });
            if (current !== generation.current) return;
          }
          const result = await accountRequest<{ events: DisplayEvent[] }>('');
          if (current !== generation.current) return;
          if (!Array.isArray(result.events)) throw new Error('Invalid saved events response');
          if (guest.length) {
            const merged = new Set(guest.map(event => event.id));
            writeSaved(JSON.stringify(guestEvents().filter(event => !merged.has(event.id))));
          }
          setEvents(result.events);
        } else if (current === generation.current) setEvents(guest);
      } catch { if (current === generation.current) setError(true); }
      finally { if (current === generation.current) { busy.current = false; setLoading(false); } }
    }
    void load();
    return () => { generation.current++; };
  }, [state, user?.id, refresh]);
  useEffect(() => {
    if (typeof window === 'undefined' || state === 'signed-in' || state === 'loading') return;
    const load = () => { try { setEvents(guestEvents()); setError(false); } catch { setError(true); } };
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, [state]);
  const toggle = useCallback((event: DisplayEvent) => {
    if (busy.current || state === 'loading' || error) return;
    const current = generation.current;
    const saved = events.some(item => item.id === event.id);
    const next = saved ? events.filter(item => item.id !== event.id) : [event, ...events];
    if (state !== 'signed-in') {
      try { writeSaved(JSON.stringify(next)); setEvents(next); setError(false); } catch { setError(true); }
      return;
    }
    busy.current = true; setLoading(true);
    const request = saved ? accountRequest(`/${event.id}`, { method: 'DELETE' }) : accountRequest('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [event.id] }) });
    void request.then(() => { if (current === generation.current) { setEvents(next); setError(false); } })
      .catch(() => { if (current === generation.current) setError(true); })
      .finally(() => { if (current === generation.current) { busy.current = false; setLoading(false); } });
  }, [events, state, error]);
  return <Context value={{ events, toggle, error, loading, retry: () => setRefresh(value => value + 1) }}>{children}</Context>;
}
export function useSavedEvents() { return use(Context); }
