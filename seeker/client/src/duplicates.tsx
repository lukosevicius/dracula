import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate, plainText, useJobs, isActive, type EventPage, type EventRow } from './data';
import EventEditor from './event-editor';
import EventItem from './event-item';
import { useEventRowEdits, type EventRowEdits } from './event-row-edits';
import { useSavedEvents } from './saved-events';
import { Feedback, Icon, PageHeading, PanelHeading } from './workspace';
import { MergePreview, type Preview } from './merge-preview';

type ServerPair = { level: 'confident' | 'likely'; conflicts: boolean; event_ids: [number, number]; preview: Preview | null };
type Pair = ServerPair & { events: [EventRow, EventRow] };
/** What a pair needs from you: nothing (the merge button takes it), value choices, or a decision whether it is the same event. */
type Category = 'ready' | 'differ' | 'possible';
type CategoryFilter = 'all' | Category;
const categoryLabels: Record<Category, string> = { ready: 'Ready to merge', differ: 'Values differ', possible: 'Possible match' };
const categoryFilters: CategoryFilter[] = ['ready', 'differ', 'possible', 'all'];
const categoryOf = (pair: ServerPair): Category => pair.level === 'likely' ? 'possible' : pair.conflicts ? 'differ' : 'ready';
const workflow = '/api/workflow/duplicates';
const rules: [string, string[]][] = [
  ['Finding pairs', [
    'Only upcoming events are compared, and only events on the same date.',
    'A different start time or a different city means a different performance, so those are never paired.',
    'Titles are compared without capitals, accents, punctuation, ticket-status words such as "Sold out" or "Išparduota", and a trailing city part such as "| Vilnius".',
    'Numbered editions with different numbers, such as "Vol. 2" and "Vol. 3", are never paired.',
  ]],
  ['Groups', [
    'Ready to merge: a confident match whose values agree. The merge button takes these.',
    'Values differ: a confident match with at least one differing value. Check the preview, pick values and merge it yourself.',
    'Possible match: not confident. Decide whether it is the same event, then merge it or mark it "Not a duplicate".',
    'A confident match has the same title, and the same start time or venue, with no two different venue names. A possible match has the same title without a matching time or venue, or titles that share most of their words.',
    'A venue name never contradicts a street address. Venues match when one name starts with the other, such as "Šv. Kotrynos bažnyčia" and "Šv. Kotrynos bažnyčia. Renginių salė".',
  ]],
  ['Merging', [
    'One event is kept: the Live one first, then one with manual edits, then the older one. The other is removed and its link redirects to the kept event.',
    'The kept event gets every source listing, so later imports update it.',
    'A value taken from the removed event is protected from being overwritten by source refreshes.',
    'Two events from the same source can be merged too. The kept event\'s listing stays the main one; the other only fills missing values on later imports.',
    '"Not a duplicate" hides the pair for good.',
  ]],
  ['Choosing values', [
    'When only one event has a value, that value is used.',
    'A venue name beats a street address, a known price beats an unknown one, a stated price such as "Nuo 12.90 €" beats a plain "Paid", and a known type beats "Unsure".',
    'Titles that differ only in capitals or punctuation are not a difference; normal case beats all capitals.',
    'Ticket links that differ only by a trailing "/" are the same. A bilietai.lt event page link beats its seat map link.',
    'Any other difference is marked "Differs" and keeps the kept event\'s value until you switch it.',
  ]],
  ['Merge ready', [
    'Shows the "Ready to merge" pairs and asks you to confirm before merging all of them. Other pairs are not touched.',
  ]],
];
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
  // Until you pick a chip, the page opens on the first group with pairs to act on.
  const [chosenCategory, setCategory] = useState<CategoryFilter | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showRules, setShowRules] = useState(false);
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
  const categoryCount = (filter: CategoryFilter) => filter === 'all' ? allPairs.length : allPairs.filter(pair => categoryOf(pair) === filter).length;
  const category = chosenCategory ?? (['ready', 'differ', 'possible'] as const).find(filter => categoryCount(filter) > 0) ?? 'all';
  const pairs = category === 'all' ? allPairs : allPairs.filter(pair => categoryOf(pair) === category);
  const ready = categoryCount('ready');
  const chooseCategory = (filter: CategoryFilter) => { setCategory(filter); setConfirming(false); };
  const mergeReady = () => {
    setConfirming(false);
    void act('all', 'merge-confident', {}, result => `Merged ${(result.merged as unknown[]).length} events.${(result.skipped as unknown[]).length ? ` ${(result.skipped as unknown[]).length} need review.` : ''}`);
  };
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
    <PageHeading title="Possible duplicates" description="Upcoming events that look like the same performance. Merging keeps one event with every source listing; the other event's link redirects to it." icon="calendar"
      actions={<button className="icon-button" type="button" aria-expanded={showRules} aria-controls="duplicate-rules" aria-label={showRules ? 'Hide duplicate rules' : 'Show duplicate rules'}
        title={showRules ? 'Hide rules' : 'How duplicates work'} onClick={() => setShowRules(open => !open)}><Icon name="info" size={18} /></button>} />
    {showRules && <section className="panel duplicate-rules" id="duplicate-rules" aria-label="Duplicate rules">
      <PanelHeading title="How duplicates work" end={<button className="icon-button" type="button" aria-label="Close rules" title="Close" onClick={() => setShowRules(false)}><Icon name="close" size={16} /></button>} />
      <div className="duplicate-rules-body">{rules.map(([heading, items]) => <div key={heading}>
        <h3>{heading}</h3>
        <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>
      </div>)}</div>
    </section>}
    <section className="panel">
      <PanelHeading title="Possible duplicate events" end={!loading && <span className="duplicate-actions">
        {withPreview.length > 0 && <button className="secondary-button preview-toggle-all" type="button" aria-label={anyOpen ? 'Hide all merge previews' : 'Show all merge previews'}
          onClick={() => setHidden(anyOpen ? new Set(withPreview.map(pairKey)) : new Set())}>
          <Icon name={anyOpen ? 'up' : 'down'} size={15} /> {anyOpen ? 'Hide previews' : 'Show previews'}
        </button>}
        <span className="count-label">{pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'}</span>
        <button className="primary-button" type="button" disabled={Boolean(merging) || ready === 0 || confirming}
          title={ready ? 'Shows the pairs that are ready to merge, then asks you to confirm.' : 'No pairs are ready to merge.'}
          onClick={() => { setCategory('ready'); setConfirming(true); }}>
          {merging === 'all' ? 'Merging…' : ready ? `Merge ${ready} ready` : 'Merge ready pairs'}
        </button>
      </span>} />
      {!loading && allPairs.length > 0 && <div className="date-quick-filters duplicate-filters" role="group" aria-label="Show pairs">
        {categoryFilters.map(filter => <button key={filter} type="button" className={`secondary-button date-filter-button ${category === filter ? 'active' : ''}`}
          aria-pressed={category === filter} onClick={() => chooseCategory(filter)}>{filter === 'all' ? 'All' : categoryLabels[filter]} · {categoryCount(filter)}</button>)}
      </div>}
      {confirming && ready > 0 && <div className="duplicate-confirm" role="alert">
        <span>Merge {ready === 1 ? 'this pair' : `these ${ready} pairs`}? Each keeps one event and redirects the other.</span>
        <button className="primary-button" type="button" disabled={Boolean(merging)} onClick={mergeReady}>Merge {ready}</button>
        <button className="secondary-button" type="button" disabled={Boolean(merging)} onClick={() => setConfirming(false)}>Cancel</button>
      </div>}
      <div className="catalogue-feedback"><Feedback message={error} error /><Feedback message={notice} /></div>
      {loading && <p className="empty-state" role="status">Looking for possible duplicates…</p>}
      {!loading && !error && !pairs.length && <p className="empty-state">{allPairs.length ? `No pairs in ${category === 'all' ? 'this view' : `"${categoryLabels[category]}"`}.` : 'No possible duplicates found.'}</p>}
      {!loading && pairs.map(pair => {
        const [first, second] = pair.events, key = `${first.id}-${second.id}`;
        return <section className="duplicate-pair" key={key}>
        <div className="duplicate-pair-heading">
          <h3>{categoryLabels[categoryOf(pair)]} · {formatDate(first.event_date!)}</h3>
          <div className="duplicate-pair-actions">
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
