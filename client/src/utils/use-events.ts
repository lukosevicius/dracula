import { useEffect, useRef, useState } from 'react';
import { apiUrl, fetchEvents, type DisplayEvent } from './events-api';
import { selectedDates, vilniusDate } from '../shared/event-date-filters';
import { matchesEventSearch, normalizeEventSearch, transitionEvents } from './event-transition';

type CachedEvents = { key: string; items: DisplayEvent[]; total: number; next: number | null };
let cachedEvents: CachedEvents | null = null;

export function useEvents(filter: string, from: string, to: string, invalid: boolean, search: string, freeOnly: boolean, city: string) {
  const key = JSON.stringify([filter, from, to, invalid, search, freeOnly, city]);
  const initialCache = useRef(cachedEvents?.key === key ? cachedEvents : null);
  const [items, setItems] = useState<DisplayEvent[]>(() => initialCache.current?.items ?? []);
  const [total, setTotal] = useState(() => initialCache.current?.total ?? 0);
  const [next, setNext] = useState<number | null>(() => initialCache.current?.next ?? null);
  const [loading, setLoading] = useState(Boolean(apiUrl) && !initialCache.current);
  const [loadedKey, setLoadedKey] = useState(initialCache.current?.key ?? '');
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!apiUrl) return;
    const current = ++generation.current;
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    if (initialCache.current?.key === key) {
      initialCache.current = null;
      return () => { active.abort(); generation.current++; };
    }
    setNext(null); setError(false);
    if (invalid) { pending.current = false; setLoading(false); return () => active.abort(); }
    pending.current = true; setLoading(true);
    async function load() {
      if (!search && !freeOnly && filter !== 'upcoming') return fetchEvents(filter, from, to, 0, active.signal, { city });
      const matches: DisplayEvent[] = [];
      const term = normalizeEventSearch(search);
      let offset: number | null = 0;
      let total = 0;
      const tomorrow = selectedDates('tomorrow', '', '')?.from;
      while (offset !== null) {
        const page = await fetchEvents(filter, from, to, offset, active.signal, { limit: 100, city });
        total = page.total;
        matches.push(...page.items.filter(event => (!freeOnly || event.price_type === 'free') && matchesEventSearch(event, term)));
        if (page.nextOffset !== null && page.nextOffset <= offset) throw new Error('Invalid pagination');
        offset = page.nextOffset;
        // The API is ordered by displayed date. Load through tomorrow so both sections
        // have accurate limits even when a day spans several API pages.
        if (!search && !freeOnly && page.items.some(event => event.event_date && tomorrow && event.event_date > tomorrow)) break;
      }
      return { items: matches, total: search || freeOnly ? matches.length : total, nextOffset: search || freeOnly ? null : offset };
    }
    load().then(page => {
      if (current !== generation.current) return;
      cachedEvents = { key, items: page.items, total: page.total, next: page.nextOffset };
      setItems(page.items); setTotal(page.total); setNext(page.nextOffset); setLoadedKey(key);
    }).catch(() => { if (!active.signal.aborted && current === generation.current) setError(true); })
      .finally(() => { if (current === generation.current) { pending.current = false; setLoading(false); } });
    return () => { active.abort(); generation.current++; };
  }, [filter, from, to, invalid, search, freeOnly, city, retry, key]);

  function loadMore() {
    if (!apiUrl || loadedKey !== key || next == null || pending.current || invalid) return;
    const active = controller.current; if (!active) return;
    const current = generation.current; pending.current = true; setLoading(true); setError(false);
    fetchEvents(filter, from, to, next, active.signal, { city }).then(page => {
      if (current !== generation.current) return;
      setItems(previous => { const merged = [...previous, ...page.items]; cachedEvents = { key, items: merged, total: page.total, next: page.nextOffset }; return merged; }); setTotal(page.total); setNext(page.nextOffset);
    }).catch(() => { if (!active.signal.aborted && current === generation.current) setError(true); })
      .finally(() => { if (current === generation.current) { pending.current = false; setLoading(false); } });
  }
  const transitioning = loadedKey !== key;
  const visibleItems = invalid ? [] : transitioning
    ? transitionEvents(items, filter, from, to, vilniusDate(), search, freeOnly, city)
    : items;
  return { items: visibleItems, total, next: transitioning ? null : next, loading: loading || (transitioning && !invalid && !error), transitioning, error, loadMore, retry: () => setRetry(value => value + 1) };
}
