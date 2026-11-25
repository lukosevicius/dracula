import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, type EventRow } from './data';
import { Feedback } from './workspace';

type RowFields = Pick<EventRow, 'review_status' | 'interest_score'>;
export type EventRowEdits = Partial<RowFields>;
type RowEdit = Pick<RowFields, 'review_status'> | Pick<RowFields, 'interest_score'>;

export function useEventRowEdits(onSaved: (id: number, patch: RowEdit) => void) {
  const active = useRef(new Map<number, EventRowEdits>());
  const [pending, setPending] = useState<ReadonlyMap<number, EventRowEdits>>(() => new Map());
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const onSavedRef = useRef(onSaved);

  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function save(id: number, patch: RowEdit) {
    const field = 'review_status' in patch ? 'review_status' : 'interest_score';
    const previous = active.current.get(id);
    if (previous?.[field] !== undefined) return;
    active.current.set(id, { ...previous, ...patch });
    setPending(new Map(active.current));
    setNotice(current => current?.error ? null : current);

    try {
      await api(`/api/events/${id}/${field === 'review_status' ? 'review' : 'interest-score'}`, patch);
      onSavedRef.current(id, patch);
      setNotice(current => current?.error ? current : { message: field === 'review_status' ? 'Review saved.' : 'Interest score saved.', error: false });
    } catch (cause) {
      setNotice({ message: `Could not save the ${field === 'review_status' ? 'review' : 'interest score'}. ${errorMessage(cause)}`, error: true });
    } finally {
      const remaining = { ...active.current.get(id) };
      delete remaining[field];
      if (Object.keys(remaining).length) active.current.set(id, remaining);
      else active.current.delete(id);
      setPending(new Map(active.current));
    }
  }

  const feedback = <div className="event-edit-feedback">
    <Feedback message={notice?.message ?? ''} error={notice?.error} />
  </div>;
  return { pending, save, feedback };
}
