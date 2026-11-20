import { useCallback, useEffect, useRef, useState } from 'react';
import type { DateFilter, ReviewStatus } from '../../types';
import { api, errorMessage, formatDate, isActive, labels, plainText, priceInfo, reviews, sourceNames, useJobs, type EventPage } from './data';
import { useSavedEvents } from './saved-events';
import EventItem from './event-item';
import EventEditor from './event-editor';
import { AvilysImport, VilniusImport, VilniusNotes } from './imports';
import { Disclosure, Feedback, Icon, Metrics, PageHeading, Pagination, PanelHeading, SearchField } from './workspace';

const pageSize = 25;
const dateOptions: [DateFilter, string][] = [
  ['upcoming', 'Upcoming'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend'],
  ['custom', 'Custom dates'], ['all', 'All dates'], ['past', 'Past'], ['unknown', 'Unknown date'],
];
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' });

function shift(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateRange(filter: DateFilter, from: string, to: string, today: string) {
  if (filter === 'today') return { from: today, to: today };
  if (filter === 'tomorrow') {
    const tomorrow = shift(today, 1);
    return { from: tomorrow, to: tomorrow };
  }
  if (filter === 'weekend') {
    const day = new Date(`${today}T12:00:00Z`).getUTCDay();
    const saturday = shift(today, day === 0 ? -1 : 6 - day);
    return { from: saturday, to: shift(saturday, 1) };
  }
  if (filter === 'custom') return { from, to: to || from };
  return null;
}

export default function EventsPage({ avilys = false }: { avilys?: boolean }) {
  const name = avilys ? 'Avilys' : 'Vilnius Events';
  const source = avilys ? 'avilys' : 'vilnius-events';
  const defaultSource = avilys ? source : 'all';
  const [data, setData] = useState<EventPage | null>(null);
  const [query, setQuery] = useState('');
  const [price, setPrice] = useState('all');
  const [when, setWhen] = useState<DateFilter>('upcoming');
  const [review, setReview] = useState('all');
  const [readiness, setReadiness] = useState('all');
  const [assistantReview, setAssistantReview] = useState('all');
  const [sourceFilter, setSourceFilter] = useState(defaultSource);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [specificDateMode, setSpecificDateMode] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [includeImages, setIncludeImages] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [pending, setPending] = useState<number[]>([]);
  const [bulkPending, setBulkPending] = useState(false);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState(false);
  const [jobError, setJobError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const catalogue = useRef<HTMLElement>(null);
  const { events: savedEvents, isSaved, toggle: toggleSaved } = useSavedEvents();
  const today = dateFormatter.format(new Date());
  const invalid = when === 'custom' && (!from || (!!to && to < from));
  const extraCount = Number(readiness !== 'all') + Number(assistantReview !== 'all') + Number(sourceFilter !== defaultSource);
  const isFiltered = Boolean(query || when !== 'upcoming' || price !== 'all' || review !== 'all' || extraCount || savedOnly);
  const sourceSavedEvents = savedEvents.filter(event => event.source_key === source);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoadError('');
    if (invalid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize), review, readiness, assistantReview, search: query, price, source: sourceFilter, when, today });
    const range = dateRange(when, from, to, today);
    if (range) {
      params.set('from', range.from);
      params.set('to', range.to);
    }
    try {
      const result = await api<EventPage>(`/api/events?${params}`);
      if (id !== requestId.current) return;
      const finalPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > finalPage) setPage(finalPage);
      else setData(result);
    } catch (error) {
      if (id === requestId.current) setLoadError(errorMessage(error));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [page, review, readiness, assistantReview, query, price, sourceFilter, when, from, to, today, invalid]);
  const loadCurrent = useRef(load);

  useEffect(() => {
    loadCurrent.current = load;
    const timer = window.setTimeout(() => void load(), query ? 180 : 0);
    return () => {
      window.clearTimeout(timer);
      requestId.current++;
    };
  }, [load, query]);

  const { jobs, start, startingSource } = useJobs(finished => {
    if (finished.some(job => ['avilys', 'vilnius-events'].includes(job.source))) void load();
  });
  const busy = startingSource !== null || jobs.some(job => ['vilnius-events', 'avilys'].includes(job.source) && isActive(job));

  function updateFilters<T>(setter: (value: T) => void, value: T) {
    setLoading(true);
    setPage(1);
    setter(value);
  }

  function resetFilters() {
    setLoading(true);
    setQuery('');
    setWhen('upcoming');
    setPrice('all');
    setReview('all');
    setReadiness('all');
    setAssistantReview('all');
    setSourceFilter(defaultSource);
    setFrom('');
    setTo('');
    setSpecificDateMode(false);
    setSavedOnly(false);
    setPage(1);
  }

  async function startVilnius(action: string, eventId?: number) {
    setJobError('');
    try {
      const jobPages = eventId ? 1 : pages;
      await start('vilnius-events', action, { pages: jobPages, event_id: eventId, include_images: includeImages });
    } catch (error) {
      setJobError(errorMessage(error));
    }
  }

  function setSelection(ids: number[], checked: boolean) {
    setSelected(current => checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)));
  }

  async function changeRow(id: number, action: string, body: unknown, success: string) {
    setPending(current => [...current, id]);
    setActionError(false);
    setMessage('');
    try {
      await api(`/api/events/${id}/${action}`, body);
      await loadCurrent.current();
      setMessage(success);
    } catch (error) {
      setActionError(true);
      setMessage(errorMessage(error));
    } finally {
      setPending(current => current.filter(value => value !== id));
    }
  }

  async function applyReview(ids: number[], status: ReviewStatus) {
    const targets = [...new Set(ids)];
    let updated = 0;
    try {
      setMessage(`Updating 0 of ${targets.length} events…`);
      for (const id of targets) {
        await api(`/api/events/${id}/review`, { review_status: status });
        updated++;
        setMessage(`Updating ${updated} of ${targets.length} events…`);
      }
      setMessage(`Updated ${updated} events to ${labels[status]}.`);
    } catch (error) {
      setActionError(true);
      setMessage(`Updated ${updated} of ${targets.length} events. ${errorMessage(error)}`);
    } finally {
      setSelection(targets.slice(0, updated), false);
      await loadCurrent.current();
    }
  }

  async function bulkReview(status: ReviewStatus, sourceWide = false) {
    if (bulkPending || pending.length) return;
    setBulkPending(true);
    setActionError(false);
    try {
      if (!sourceWide) {
        if (selected.length) await applyReview(selected, status);
        return;
      }
      setMessage(`Finding unsure events from ${name}…`);
      const ids: number[] = [];
      let next = 1;
      let batch: EventPage;
      do {
        const params = new URLSearchParams({ source, review: 'unsure', when: 'all', page: String(next++), limit: '100' });
        batch = await api<EventPage>(`/api/events?${params}`);
        ids.push(...batch.events.map(event => event.id));
      } while (batch.events.length && ids.length < batch.total);
      if (ids.length) await applyReview(ids, status);
      else setMessage(`No unsure events from ${name}.`);
    } catch (error) {
      setActionError(true);
      setMessage(errorMessage(error));
    } finally {
      setBulkPending(false);
    }
  }

  const savedRows = sourceSavedEvents.filter(row => {
    const eventDate = row.event_date;
    const eventEnd = row.event_end_date || eventDate;
    const dateWindow = dateRange(when, from, to, today);
    const matchesWhen = when === 'all'
      || (when === 'upcoming' && !!eventDate && !!eventEnd && eventEnd >= today)
      || (when === 'past' && !!eventEnd && eventEnd < today)
      || (when === 'unknown' && !eventDate)
      || (!!dateWindow && !!eventDate && !!eventEnd && eventDate <= dateWindow.to && eventEnd >= dateWindow.from);
    const savedPrice = priceInfo(row);
    const ready = row.review_status === 'music' && (!eventDate || !eventEnd || eventEnd >= today);
    return matchesWhen
      && (!query || plainText(row.title).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      && (price === 'all' || savedPrice.type === price)
      && (review === 'all' || row.review_status === review)
      && (readiness === 'all' || (readiness === 'ready' ? ready : !ready))
      && (assistantReview !== 'pending' || (!!row.assistant_reviewed_at && !row.assistant_confirmed_at))
      && (sourceFilter === 'all' || row.source_key === sourceFilter);
  });
  const rows = invalid ? [] : savedOnly ? savedRows : data?.events ?? [];
  const rowIds = rows.map(row => row.id);
  const allSelected = rowIds.length > 0 && rowIds.every(id => selected.includes(id));

  return (
    <>
      <PageHeading title={name} description={avilys ? 'Import and review Vilnius music events from Avilys.' : 'Review imported events and manage the Go Vilnius feed.'} icon={avilys ? 'avilys' : 'calendar'} href={avilys ? 'https://avilys.app/paieska' : 'https://www.vilnius-events.lt/'} linkLabel={`Open ${name}`} tools />
      {!avilys && <Metrics items={[
        { label: 'Events across all sources', value: data?.counts.total.toLocaleString() ?? '—', icon: 'calendar' },
        { label: 'Ready for Dracula', value: data?.readyCount.toLocaleString() ?? '—', icon: 'check' },
        { label: 'Unsure across all sources', value: data?.counts.unsure.toLocaleString() ?? '—', icon: 'filter' },
      ]} />}
      <div className="workspace-grid">
        <div className="main-stack">
          <section className="panel catalogue" ref={catalogue}>
            <PanelHeading title="Imported events" end={savedOnly ? <span className="count-label">{rows.length} saved matching</span> : data && !invalid && <span className="count-label">{data.total.toLocaleString()} matching</span>} />
            <div className="catalogue-tools event-tools">
              <SearchField label="Search by event title" value={query} onChange={value => updateFilters(setQuery, value)} />
              <div className="filter-grid">
                <label className="field">When <select value={when} onChange={event => { setSpecificDateMode(false); updateFilters(setWhen, event.target.value as DateFilter); }}>
                  {dateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select></label>
                <label className="field">Price <select value={price} onChange={event => updateFilters(setPrice, event.target.value)}>
                  <option value="all">All prices</option><option value="free">Free</option><option value="paid">Paid</option><option value="unknown">Unknown</option>
                </select></label>
                <label className="field">Review <select value={review} onChange={event => updateFilters(setReview, event.target.value)}>
                  <option value="all">All statuses</option>{reviews.map(status => <option key={status} value={status}>{labels[status]}</option>)}
                </select></label>
              </div>
              <div className="date-quick-filters" role="group" aria-label="Quick date filters">
                {(['today', 'tomorrow'] as const).map(filter => <button
                  key={filter}
                  type="button"
                  className={`secondary-button date-filter-button ${when === filter ? 'active' : ''}`}
                  aria-pressed={when === filter}
                  onClick={() => { setSpecificDateMode(false); setFrom(''); setTo(''); updateFilters(setWhen, filter); }}
                >{filter === 'today' ? 'Today' : 'Tomorrow'}</button>)}
                <button
                  type="button"
                  className={`secondary-button date-filter-button ${specificDateMode && when === 'custom' ? 'active' : ''}`}
                  aria-pressed={specificDateMode && when === 'custom'}
                  onClick={() => {
                    setSpecificDateMode(true);
                    setFrom('');
                    setTo('');
                    updateFilters(setWhen, 'custom');
                  }}
                >Specific date</button>
                {specificDateMode && when === 'custom' && <label className="field specific-date-field">Date
                  <input type="date" value={from} onChange={event => {
                    const date = event.target.value;
                    setLoading(true);
                    setPage(1);
                    setFrom(date);
                    setTo(date);
                  }} />
                </label>}
              </div>
              {when === 'custom' && !specificDateMode && <div className="field-grid custom-dates">
                <label className="field">From <input type="date" value={from} onChange={event => updateFilters(setFrom, event.target.value)} /></label>
                <label className="field">To <input type="date" min={from || undefined} value={to} onChange={event => updateFilters(setTo, event.target.value)} /></label>
              </div>}
              <div className="filter-footer">
                <Disclosure className="filter-disclosure" title={<><Icon name="filter" size={15} /> More filters{extraCount ? ` (${extraCount})` : ''}</>}>
                  <div className="filter-grid">
                    <label className="field">Dracula export <select value={readiness} onChange={event => updateFilters(setReadiness, event.target.value)}>
                      <option value="all">All events</option><option value="ready">Ready for Dracula</option><option value="attention">Not ready</option>
                    </select></label>
                    <label className="field">Assistant review <select value={assistantReview} onChange={event => updateFilters(setAssistantReview, event.target.value)}>
                      <option value="all">All events</option><option value="pending">Needs my check</option>
                    </select></label>
                    {!avilys && <label className="field">Source <select value={sourceFilter} onChange={event => updateFilters(setSourceFilter, event.target.value)}>
                      <option value="all">All sources</option>{data?.sources.map(item => <option key={item.source_key} value={item.source_key}>{sourceNames[item.source_key] ?? item.source_key}</option>)}
                    </select></label>}
                  </div>
                  <p>Events marked Music are ready if they have no date or have yet to end. Choose All dates to include undated events.</p>
                </Disclosure>
                <button type="button" className={`secondary-button saved-only-toggle ${savedOnly ? 'active' : ''}`} aria-pressed={savedOnly} onClick={() => {
                  setSavedOnly(current => !current);
                  setPage(1);
                  setSelected([]);
                  setOpen(null);
                }}><Icon name="save" size={15} /> Saved only · {sourceSavedEvents.length}</button>
                {isFiltered && <button type="button" className="text-button reset-filters" onClick={resetFilters}>Reset filters</button>}
              </div>
              {invalid && <Feedback error message={!from ? 'Choose a start date.' : 'End date must be on or after the start date.'} />}
            </div>
            <div className="selection-bar">
              <label className="checkbox-label"><input type="checkbox" checked={allSelected} ref={element => { if (element) element.indeterminate = !allSelected && rowIds.some(id => selected.includes(id)); }} disabled={!rows.length || loading || bulkPending} onChange={event => setSelection(rowIds, event.target.checked)} /> Select this page</label>
              {selected.length > 0 && <div className="selection-actions">
                <strong>{selected.length} selected</strong>
                {reviews.map(status => <button className="secondary-button" type="button" key={status} disabled={bulkPending || pending.length > 0} onClick={() => void bulkReview(status)}>{labels[status]}</button>)}
                <button className="text-button" type="button" disabled={bulkPending} onClick={() => setSelected([])}>Clear selection</button>
              </div>}
            </div>
            <div className="catalogue-feedback"><Feedback message={message} error={actionError} /></div>
            {loadError && <div className="catalogue-error"><Feedback message={loadError} error /><button className="secondary-button" type="button" onClick={() => void load()}>Retry</button></div>}
            <div className="event-list" aria-busy={loading}>
              {rows.map(row => (
                <EventItem key={row.id} row={row} today={today} showSource={!avilys} open={open === row.id} toggle={() => setOpen(current => current === row.id ? null : row.id)}
                  selected={selected.includes(row.id)} select={checked => setSelection([row.id], checked)} disabled={bulkPending || pending.includes(row.id) || loading}
                  review={status => void changeRow(row.id, 'review', { review_status: status }, 'Review saved.')}
                  confirm={() => void changeRow(row.id, 'confirm-assistant-review', {}, 'Assistant review checked.')}
                  editor={<EventEditor row={row} today={today} onSaved={() => loadCurrent.current()} onRefresh={() => void startVilnius('details-event', row.id)} refreshing={busy} />}
                  saved={isSaved(row.id)} toggleSaved={() => toggleSaved(row)} />
              ))}
              {!rows.length && !loadError && !invalid && <p className="empty-state" role="status">{loading ? 'Loading events…' : 'No events match these filters.'}</p>}
            </div>
            {!savedOnly && data && !invalid && data.total > pageSize && <Pagination page={data.page} total={data.total} size={pageSize} onChange={next => {
              setPage(next);
              catalogue.current?.scrollIntoView({ block: 'start' });
            }} />}
          </section>
          {!avilys && <VilniusNotes />}
        </div>
        <aside className="context-column" id="import-tools" tabIndex={-1} aria-label="Event source tools">
          {avilys
            ? <AvilysImport jobs={jobs} busy={busy} start={start} />
            : <VilniusImport pages={pages} setPages={setPages} includeImages={includeImages} setIncludeImages={setIncludeImages} nextPage={data?.nextPage} jobs={jobs} busy={busy} run={action => void startVilnius(action)} runs={data?.runs ?? []} />}
          <Feedback message={jobError} error />
          <Disclosure className="standalone" title="Bulk review by source">
            <div className="stack">
              <p>Mark every Unsure event from {name} as Music, across all dates and pages.</p>
              <button className="secondary-button" type="button" disabled={bulkPending || pending.length > 0} onClick={() => void bulkReview('music', true)}>Mark all Unsure as Music</button>
            </div>
          </Disclosure>
        </aside>
      </div>
    </>
  );
}
