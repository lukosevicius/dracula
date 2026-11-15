import { useEffect, useRef, useState } from 'react';
import { apiUrl, fetchEvents, type DisplayEvent } from './events-api';

export function useEvents(filter: string, from: string, to: string, invalid: boolean) {
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
    fetchEvents(filter, from, to, 0, active.signal).then(page => {
      if (current !== generation.current) return;
      setItems(page.items); setTotal(page.total); setNext(page.nextOffset);
    }).catch(() => { if (!active.signal.aborted && current === generation.current) setError(true); })
      .finally(() => { if (current === generation.current) { pending.current = false; setLoading(false); } });
    return () => { active.abort(); generation.current++; };
  }, [filter, from, to, invalid, retry]);

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
