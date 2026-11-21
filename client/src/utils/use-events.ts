import { useEffect, useRef, useState } from 'react';
import { apiUrl, fetchEvents, type DisplayEvent } from './events-api';
import { displayText } from './event-format';
import { selectedDates } from '../shared/event-date-filters';

export function useEvents(filter: string, from: string, to: string, invalid: boolean, search: string, freeOnly: boolean) {
  const [items, setItems] = useState<DisplayEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(Boolean(apiUrl));
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
    setItems([]); setNext(null); setTotal(0); setError(false);
    if (invalid) { pending.current = false; setLoading(false); return () => active.abort(); }
    pending.current = true; setLoading(true);
    async function load() {
      if (!search && !freeOnly && filter !== 'upcoming') return fetchEvents(filter, from, to, 0, active.signal);
      const matches: DisplayEvent[] = [];
      const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('lt');
      const term = normalize(search);
      let offset: number | null = 0;
      let total = 0;
      const tomorrow = selectedDates('tomorrow', '', '')?.from;
      while (offset !== null) {
        const page = await fetchEvents(filter, from, to, offset, active.signal, 100);
        total = page.total;
        matches.push(...page.items.filter(event => (!freeOnly || event.price_type === 'free') && (!search || normalize([event.title, event.venue ?? '', ...event.artists.map(artist => artist.name)].map(displayText).join(' ')).includes(term))));
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
      setItems(page.items); setTotal(page.total); setNext(page.nextOffset);
    }).catch(() => { if (!active.signal.aborted && current === generation.current) setError(true); })
      .finally(() => { if (current === generation.current) { pending.current = false; setLoading(false); } });
    return () => { active.abort(); generation.current++; };
  }, [filter, from, to, invalid, search, freeOnly, retry]);

  function loadMore() {
    if (!apiUrl || next == null || pending.current || invalid) return;
    const active = controller.current; if (!active) return;
    const current = generation.current; pending.current = true; setLoading(true); setError(false);
    fetchEvents(filter, from, to, next, active.signal).then(page => {
      if (current !== generation.current) return;
      setItems(previous => [...previous, ...page.items]); setTotal(page.total); setNext(page.nextOffset);
    }).catch(() => { if (!active.signal.aborted && current === generation.current) setError(true); })
      .finally(() => { if (current === generation.current) { pending.current = false; setLoading(false); } });
  }
  return { items, total, next, loading, error, loadMore, retry: () => setRetry(value => value + 1) };
}
