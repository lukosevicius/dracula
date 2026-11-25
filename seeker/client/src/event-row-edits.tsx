import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, type EventRow, type PublicationStatus } from './data';
import { Feedback } from './workspace';

type Publication = { publication_status: PublicationStatus; revision: number };
export type EventRowEdits = Partial<Pick<EventRow, 'review_status' | 'interest_score'> & Publication>;
type RowEdit = Pick<EventRow, 'review_status'> | Pick<EventRow, 'interest_score'> | Pick<Publication, 'publication_status'>;

const editMessages = {
  publication_status: { name: 'publication status', success: 'Publication status saved.' },
  review_status: { name: 'review', success: 'Review saved.' },
  interest_score: { name: 'interest score', success: 'Interest score saved.' },
};

async function readPublication(path: string): Promise<Publication> {
  const { publication_status, revision } = await api<Publication>(path + '/verification');
  return { publication_status, revision };
}

export function useEventRowEdits(onSaved: (id: number, patch: EventRowEdits) => void) {
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

  async function save(id: number, patch: RowEdit, revision?: number) {
    const field = 'publication_status' in patch ? 'publication_status' : 'review_status' in patch ? 'review_status' : 'interest_score';
    const publicationPath = `/api/workflow/events/${id}`;
    const previous = active.current.get(id);
    if (previous?.[field] !== undefined) return;
    active.current.set(id, { ...previous, ...patch });
    setPending(new Map(active.current));
    setNotice(current => current?.error ? null : current);

    try {
      let confirmed: EventRowEdits = patch;
      if ('publication_status' in patch) {
        const eventRevision = revision ?? (await readPublication(publicationPath)).revision;
        await api(publicationPath + '/publication', { status: patch.publication_status, revision: eventRevision });
        confirmed = await readPublication(publicationPath).catch(() => patch);
      } else {
        await api(`/api/events/${id}/${field === 'review_status' ? 'review' : 'interest-score'}`, patch);
      }
      onSavedRef.current(id, confirmed);
      setNotice(current => current?.error ? current : { message: editMessages[field].success, error: false });
    } catch (cause) {
      setNotice({ message: `Could not save the ${editMessages[field].name}. ${errorMessage(cause)}`, error: true });
      if (field === 'publication_status') {
        const current = await readPublication(publicationPath).catch(() => null);
        if (current) onSavedRef.current(id, current);
      }
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
