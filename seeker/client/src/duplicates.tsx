import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate, plainText, useJobs, isActive, type EventPage, type EventRow } from './data';
import EventEditor from './event-editor';
import EventItem from './event-item';
import { useEventRowEdits, type EventRowEdits } from './event-row-edits';
import { useSavedEvents } from './saved-events';
import { Feedback, Icon, PageHeading, PanelHeading } from './workspace';
import { MergePreview, type Preview } from './merge-preview';

type ServerPair = { level: 'confident' | 'likely'; mergeable: boolean; conflicts: boolean; event_ids: [number, number]; preview: Preview | null };
type Pair = ServerPair & { events: [EventRow, EventRow] };
type LevelFilter = 'all' | ServerPair['level'];
const levelFilters: [LevelFilter, string][] = [['all', 'All matches'], ['confident', 'Confident'], ['likely', 'Likely']];
const workflow = '/api/workflow/duplicates';
const todayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' });

export default function DuplicatesPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [serverPairs, setServerPairs] = useState<ServerPair[]>([]);
  const [merging, setMerging] = useState('');
  // Previews are open unless hidden here.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [openKey, setOpenKey] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const editsDuringLoad = useRef<Map<number, EventRowEdits> | null>(null);
  const { isSaved, toggle, update, refresh, pendingIds, loading: savedLoading } = useSavedEvents();
  const { jobs, start, startingSource } = useJobs(() => {});
  const refreshing = startingSource !== null || jobs.some(job => ['avilys', 'vilnius-events'].includes(job.source) && isActive(job));
  const today = todayFormatter.format(new Date());
  const rowEdits = useEventRowEdits((id, patch) => {
    const loadingEdits = editsDuringLoad.current;
    loadingEdits?.set(id, { ...loadingEdits.get(id), ...patch });
    setEvents(current => current.map(event => event.id === id ? { ...event, ...patch } : event));
    update(id, patch);
    if (isSaved(id) || pendingIds.includes(id)) void refresh(id);
  });

  const load = useCallback(async (silent = false) => {
    const edits = new Map<number, EventRowEdits>();
    editsDuringLoad.current = edits;
    if (!silent) setLoading(true);
    setError('');
    try {
      const found = api<{ pairs: ServerPair[] }>(workflow);
      const rows: EventRow[] = [];
      let page = 1;
      let result: EventPage;
      do {
        result = await api<EventPage>(`/api/events?when=all&source=all&limit=100&page=${page++}`);
        rows.push(...result.events);
      } while (result.events.length && rows.length < result.total);
      const { pairs: duplicatePairs } = await found;
      if (editsDuringLoad.current === edits) {
        setEvents(rows.map(row => edits.has(row.id) ? { ...row, ...edits.get(row.id) } : row));
        setServerPairs(duplicatePairs);
      }
    } catch (cause) {
      if (editsDuringLoad.current === edits) setError(errorMessage(cause));
    } finally {
      if (editsDuringLoad.current === edits) {
        editsDuringLoad.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function confirmAssistantReview(id: number) {
    setPendingId(id);
    setError('');
    try {
      await api(`/api/events/${id}/confirm-assistant-review`, {});
      await Promise.all([load(true), isSaved(id) ? refresh(id) : undefined]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setPendingId(null); }
  }

  async function refreshSource(row: EventRow) {
    try { await start('vilnius-events', 'details-event', { event_id: row.id }); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  async function act(key: string, path: string, body: unknown, success: (result: Record<string, unknown>) => string) {
    setMerging(key);
    setError('');
    setNotice('');
    try {
      const result = await api<Record<string, unknown>>(`${workflow}/${path}`, body);
      setNotice(success(result));
      await load(true);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setMerging(''); }
  }

  const byId = new Map(events.map(event => [event.id, event]));
  const allPairs: Pair[] = serverPairs.flatMap(pair => {
    const [first, second] = pair.event_ids.map(id => byId.get(id));
    return first && second ? [{ ...pair, events: [first, second] as [EventRow, EventRow] }] : [];
  });
  const pairs = level === 'all' ? allPairs : allPairs.filter(pair => pair.level === level);
  const levelCount = (filter: LevelFilter) => filter === 'all' ? allPairs.length : allPairs.filter(pair => pair.level === filter).length;
  const ready = allPairs.filter(pair => pair.level === 'confident' && pair.mergeable && !pair.conflicts).length;
  const pairKey = (pair: Pair) => pair.event_ids.join('-');
  const withPreview = pairs.filter(pair => pair.preview);
  const anyOpen = withPreview.some(pair => !hidden.has(pairKey(pair)));
  const togglePreview = (key: string) => setHidden(current => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  return <>
    {rowEdits.feedback}
    <PageHeading title="Possible duplicates" description="Upcoming events that look like the same performance. Merging keeps one event with every source listing; the other event's link redirects to it." icon="calendar" />
    <section className="panel">
      <PanelHeading title="Possible duplicate events" end={!loading && <span className="duplicate-actions">
        {withPreview.length > 0 && <button className="secondary-button preview-toggle-all" type="button" aria-label={anyOpen ? 'Hide all merge previews' : 'Show all merge previews'}
          onClick={() => setHidden(anyOpen ? new Set(withPreview.map(pairKey)) : new Set())}>
          <Icon name={anyOpen ? 'up' : 'down'} size={15} /> {anyOpen ? 'Hide previews' : 'Show previews'}
        </button>}
        <span className="count-label">{pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'}</span>
        <button className="primary-button" type="button" disabled={Boolean(merging) || ready === 0}
          title={ready ? 'Merges confident matches whose values agree. Pairs marked "Values differ" stay for review.' : 'No confident matches without differences to merge.'}
          onClick={() => void act('all', 'merge-confident', {}, result => `Merged ${(result.merged as unknown[]).length} events.${(result.skipped as unknown[]).length ? ` ${(result.skipped as unknown[]).length} need review.` : ''}`)}>
          {merging === 'all' ? 'Merging…' : ready ? `Merge ${ready} confident ${ready === 1 ? 'match' : 'matches'}` : 'Merge confident matches'}
        </button>
      </span>} />
      {!loading && allPairs.length > 0 && <div className="date-quick-filters duplicate-filters" role="group" aria-label="Match type">
        {levelFilters.map(([filter, label]) => <button key={filter} type="button" className={`secondary-button date-filter-button ${level === filter ? 'active' : ''}`}
          aria-pressed={level === filter} onClick={() => setLevel(filter)}>{label} · {levelCount(filter)}</button>)}
      </div>}
      <div className="catalogue-feedback"><Feedback message={error} error /><Feedback message={notice} /></div>
      {loading && <p className="empty-state" role="status">Looking for possible duplicates…</p>}
      {!loading && !error && !pairs.length && <p className="empty-state">{allPairs.length ? `No ${level} matches.` : 'No possible duplicates found.'}</p>}
      {!loading && pairs.map(pair => {
        const [first, second] = pair.events, key = `${first.id}-${second.id}`;
        return <section className="duplicate-pair" key={key}>
        <div className="duplicate-pair-heading">
          <h3>{pair.level === 'confident' ? 'Confident match' : 'Likely match'} · {formatDate(first.event_date!)}{pair.mergeable && pair.conflicts && <span className="merge-preview-flag">Values differ</span>}</h3>
          <div className="duplicate-pair-actions">
            {!pair.mergeable && <span className="duplicate-note">Same source listed twice. Unpublish the extra listing.</span>}
            <button className="text-button" type="button" disabled={Boolean(merging)}
              onClick={() => void act(`${key}-distinct`, 'dismiss', { event_ids: [first.id, second.id] }, () => 'Marked as different events.')}>Not a duplicate</button>
            {pair.preview && <button className="icon-button preview-toggle" type="button" aria-expanded={!hidden.has(key)} aria-controls={`merge-preview-${key}`}
              aria-label={hidden.has(key) ? 'Show merge preview' : 'Hide merge preview'} title={hidden.has(key) ? 'Show merge preview' : 'Hide merge preview'}
              onClick={() => togglePreview(key)}>
              <Icon name={hidden.has(key) ? 'down' : 'up'} size={16} />
            </button>}
          </div>
        </div>
        <div className="event-list">{[first, second].map(row => {
          const key = `${first.id}-${second.id}-${row.id}`;
          return <EventItem key={key} row={row} today={today} open={openKey === key} toggle={() => setOpenKey(current => current === key ? '' : key)}
            selected={false} select={() => {}} selectionEnabled={false} disabled={savedLoading}
            pendingEdit={rowEdits.pending.get(row.id)} bookmarkPending={pendingIds.includes(row.id)} confirmPending={pendingId === row.id}
            changePublication={status => void rowEdits.save(row.id, { publication_status: status }, row.revision)}
            review={status => void rowEdits.save(row.id, { review_status: status })}
            confirm={() => void confirmAssistantReview(row.id)}
            changeInterestScore={score => void rowEdits.save(row.id, { interest_score: score })}
            showSource saved={isSaved(row.id)} toggleSaved={() => void toggle(row)}
            editor={<EventEditor row={row} onSaved={() => load(true)} onRefresh={() => void refreshSource(row)} refreshing={refreshing} />} />;
        })}</div>
        {pair.preview && !hidden.has(key) && <div id={`merge-preview-${key}`}>
          <MergePreview key={JSON.stringify(pair.preview)} preview={pair.preview} eventIds={pair.event_ids}
            onMerged={message => { setError(''); setNotice(message); void load(true); }} />
        </div>}
      </section>;
      })}
    </section>
  </>;
}
