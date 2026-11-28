import { VerificationJobs, VerificationRequest, useVerificationJobs, verificationLabels } from './verification';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { DateFilter, ReviewStatus } from '../../types';
import { api, errorMessage, isActive, labels, plainText, priceInfo, reviews, seekerSettingsPath, sourceNames, useJobs, type EventPage, type EventRow, type SeekerSettingsResponse } from './data';
import { groupNewestEvents, shiftDate } from './event-groups';
import { useSavedEvents } from './saved-events';
import EventItem from './event-item';
import { useEventRowEdits } from './event-row-edits';
import EventEditor from './event-editor';
import { AvilysImport, KakavaImport, VilniusImport, VilniusNotes } from './imports';
import { Disclosure, Feedback, Icon, Metrics, PageHeading, Pagination, PanelHeading, SearchField } from './workspace';

const pageSize = 25;
type EventDateFilter = DateFilter | 'newest';
const quickDateOptions = [['newest', 'Newest'], ['today', 'Today'], ['tomorrow', 'Tomorrow']] as const;
const dateOptions: ReadonlyArray<readonly [EventDateFilter, string]> = [
  ...quickDateOptions, ['upcoming', 'Upcoming'], ['weekend', 'This weekend'],
  ['custom', 'Custom dates'], ['all', 'All dates'], ['past', 'Past'], ['unknown', 'Unknown date'],
];
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' });

function preserveUnchangedRows(previous: EventPage | null, next: EventPage): EventPage {
  if (!previous) return next;
  const previousById = new Map(previous.events.map(event => [event.id, event]));
  return {
    ...next,
    events: next.events.map(event => {
      const oldEvent = previousById.get(event.id);
      return oldEvent && Object.keys(event).every(key => oldEvent[key as keyof typeof oldEvent] === event[key as keyof typeof event])
        ? oldEvent
        : event;
    }),
  };
}

function dateRange(filter: DateFilter, from: string, to: string, today: string) {
  if (filter === 'today') return { from: today, to: today };
  if (filter === 'tomorrow') {
    const tomorrow = shiftDate(today, 1);
    return { from: tomorrow, to: tomorrow };
  }
  if (filter === 'weekend') {
    const day = new Date(`${today}T12:00:00Z`).getUTCDay();
    const saturday = shiftDate(today, day === 0 ? -1 : 6 - day);
    return { from: saturday, to: shiftDate(saturday, 1) };
  }
  if (filter === 'custom') return { from, to: to || from };
  return null;
}

export default function EventsPage({ avilys = false, kakava = false, all = false, queue }: { avilys?: boolean; kakava?: boolean; all?: boolean; queue?: 'attention' | 'not-music' }) {
  const name = queue === 'attention' ? 'Needs attention' : queue === 'not-music' ? 'Other events' : all ? 'All events' : avilys ? 'Avilys' : kakava ? 'Kakava' : 'Vilnius Events';
  const source = all ? 'all' : avilys ? 'avilys' : kakava ? 'kakava' : 'vilnius-events';
  const defaultSource = source;
  const [data, setData] = useState<EventPage | null>(null);
  const [query, setQuery] = useState('');
  const [price, setPrice] = useState('all');
  const [city, setCity] = useState('all');
  const [time, setTime] = useState('all');
  const [sort, setSort] = useState<'date' | 'score-asc' | 'score-desc'>('date');
  const defaultWhen = queue ? 'all' : 'newest';
  const [when, setWhen] = useState<EventDateFilter>(defaultWhen);
  const [review, setReview] = useState(queue === 'not-music' ? 'other' : 'all');
  const [publication, setPublication] = useState('all');
  const [verification, setVerification] = useState('all');
  const [verifyAfterImport, setVerifyAfterImport] = useState<boolean | null>(null);
  const [importDefaultError, setImportDefaultError] = useState('');
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
  const { events: savedEvents, isSaved, toggle: toggleSaved, update: updateSavedEvent, refresh: refreshSavedEvent, loading: savedEventsLoading, error: savedEventsError, pendingIds: savedPendingIds } = useSavedEvents();
  const today = dateFormatter.format(new Date());
  const apiWhen = when === 'newest' ? 'upcoming' : when;
  const invalid = when === 'custom' && (!from || (!!to && to < from));
  const extraCount = Number(assistantReview !== 'all') + Number(sourceFilter !== defaultSource) + Number(verification !== 'all');
  const isFiltered = Boolean(query || when !== defaultWhen || price !== 'all' || city !== 'all' || time !== 'all' || publication !== 'all' || (review !== 'all' && queue !== 'not-music') || extraCount || savedOnly || sort !== 'date');
  const sourceSavedEvents = savedEvents.filter(event => all || event.source_key === source);

  useEffect(() => {
    if (all) return;
    let active = true;
    void api<SeekerSettingsResponse>(seekerSettingsPath).then(({ settings }) => {
      if (active) setVerifyAfterImport(settings.verify_after_import !== false);
    }).catch(() => {
      if (!active) return;
      setVerifyAfterImport(false);
      setImportDefaultError('Could not load the saved AI verification default. Choose whether to verify before importing.');
    });
    return () => { active = false; };
  }, [all]);

  const load = useCallback(async (silent = false) => {
    const id = ++requestId.current;
    setLoadError('');
    if (invalid) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize), review, assistantReview, search: query, price, city, time, source: sourceFilter, when: apiWhen, today, sort, publication, verification, needs_attention: queue === 'attention' ? 'yes' : 'all' });
    const range = dateRange(apiWhen, from, to, today);
    if (range) {
      params.set('from', range.from);
      params.set('to', range.to);
    }
    try {
      const result = await api<EventPage>(`/api/events?${params}`);
      if (id !== requestId.current) return;
      const finalPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > finalPage) setPage(finalPage);
      else setData(current => preserveUnchangedRows(current, result));
    } catch (error) {
      if (id === requestId.current) setLoadError(errorMessage(error));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [page, review, assistantReview, query, price, city, time, sourceFilter, when, apiWhen, from, to, today, invalid, sort, publication, verification, queue]);
  const loadCurrent = useRef(load);
  const rowEdits = useEventRowEdits((id, patch) => {
    setData(current => current ? { ...current, events: current.events.map(event => event.id === id ? { ...event, ...patch } : event) } : current);
    updateSavedEvent(id, patch);
    void refreshEditedEvent(id);
  });

  useEffect(() => {
    loadCurrent.current = load;
    const timer = window.setTimeout(() => void load(), query ? 180 : 0);
    return () => {
      window.clearTimeout(timer);
      requestId.current++;
    };
  }, [load, query]);

  const verificationJobs = useVerificationJobs(() => { void loadCurrent.current(true); });
  const { jobs, start, startingSource } = useJobs(finished => {
    if (finished.some(job => ['avilys', 'kakava', 'vilnius-events'].includes(job.source))) void load();
  });
  const busy = startingSource !== null || jobs.some(job => ['vilnius-events', 'avilys', 'kakava'].includes(job.source) && isActive(job));

  function updateFilters<T>(setter: (value: T) => void, value: T) {
    setLoading(true);
    setPage(1);
    setter(value);
  }

  function changeWhen(value: EventDateFilter) {
    if (value === when && page === 1 && !specificDateMode) return;
    setSpecificDateMode(false);
    if (value === 'newest') setSort('date');
    updateFilters(setWhen, value);
  }

  function resetFilters() {
    setLoading(true);
    setQuery('');
    setWhen(defaultWhen);
    setPrice('all');
    setCity('all');
    setTime('all');
    setSort('date');
    setReview(queue === 'not-music' ? 'other' : 'all');
    setPublication('all');
    setVerification('all');
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
      await start('vilnius-events', action, { pages: jobPages, event_id: eventId, include_images: includeImages, verify_after_import: verifyAfterImport === true });
    } catch (error) {
      setJobError(errorMessage(error));
    }
  }

  function setSelection(ids: number[], checked: boolean) {
    setSelected(current => checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)));
  }

  async function confirmAssistantReview(id: number) {
    setPending(current => [...current, id]);
    setActionError(false);
    setMessage('');
    try {
      await api(`/api/events/${id}/confirm-assistant-review`, {});
      await refreshEditedEvent(id);
      setMessage('Assistant review checked.');
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
    if (bulkPending || pending.length || rowEdits.pending.size) return;
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

  const dateWindow = dateRange(apiWhen, from, to, today);
  const savedRows = sourceSavedEvents.filter(row => {
    const eventDate = row.event_date;
    const eventEnd = row.event_end_date || eventDate;
    const matchesWhen = apiWhen === 'all'
      || (apiWhen === 'upcoming' && !!eventDate && !!eventEnd && eventEnd >= today)
      || (apiWhen === 'past' && !!eventEnd && eventEnd < today)
      || (apiWhen === 'unknown' && !eventDate)
      || (!!dateWindow && !!eventDate && !!eventEnd && eventDate <= dateWindow.to && eventEnd >= dateWindow.from);
    const savedPrice = priceInfo(row);
    return matchesWhen
      && (!query || plainText(row.title).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      && (price === 'all' || savedPrice.type === price)
      && (city === 'all' || (city === 'none' ? !row.city?.trim() : row.city?.trim() === city))
      && (time === 'all' || (time === 'known' ? Boolean(row.event_time?.trim()) : !row.event_time?.trim()))
      && (queue !== 'attention' || Boolean(row.needs_attention))
      && (publication === 'all' || row.publication_status === publication)
      && (verification === 'all' || (row.verification_status ?? 'not_verified') === verification)
      && (review === 'all' || row.review_status === review)
      && (assistantReview !== 'pending' || (!!row.assistant_reviewed_at && !row.assistant_confirmed_at))
      && (sourceFilter === 'all' || row.source_key === sourceFilter);
  }).sort((a, b) => {
    const dateCompare = (a.event_date ? 0 : 1) - (b.event_date ? 0 : 1)
      || (when === 'past' ? -1 : 1) * (a.event_date || '').localeCompare(b.event_date || '')
      || (when === 'past' ? -1 : 1) * (a.event_time || '').localeCompare(b.event_time || '');
    if (sort === 'score-desc') return (b.interest_score || 1) - (a.interest_score || 1) || dateCompare;
    if (sort === 'score-asc') return (a.interest_score || 1) - (b.interest_score || 1) || dateCompare;
    return dateCompare;
  });
  const filteredRows = invalid ? [] : savedOnly ? savedRows : data?.events ?? [];
  const rows = when === 'newest' ? filteredRows.filter(row => row.event_date && (row.event_end_date || row.event_date) >= today) : filteredRows;
  const groups = when === 'newest' ? groupNewestEvents(rows, today) : null;
  const rowIds = rows.map(row => row.id);
  const allSelected = rowIds.length > 0 && rowIds.every(id => selected.includes(id));

  async function refreshEditedEvent(id: number) {
    await Promise.all([loadCurrent.current(true), isSaved(id) || savedPendingIds.includes(id) ? refreshSavedEvent(id) : undefined]);
  }

  function renderEvent(row: EventRow) {
    return <EventItem key={row.id} row={row} today={today} showSource={all} open={open === row.id} toggle={() => setOpen(current => current === row.id ? null : row.id)}
      selected={selected.includes(row.id)} select={checked => setSelection([row.id], checked)} disabled={bulkPending || loading || savedEventsLoading}
      pendingEdit={rowEdits.pending.get(row.id)} bookmarkPending={savedPendingIds.includes(row.id)} confirmPending={pending.includes(row.id)}
      changePublication={status => void rowEdits.save(row.id, { publication_status: status }, row.revision)}
      review={status => void rowEdits.save(row.id, { review_status: status })}
      confirm={() => void confirmAssistantReview(row.id)}
      changeInterestScore={score => void rowEdits.save(row.id, { interest_score: score })}
      editor={<EventEditor row={row} onSaved={() => refreshEditedEvent(row.id)} onRefresh={() => void startVilnius('details-event', row.id)} refreshing={busy} />}
      saved={isSaved(row.id)} toggleSaved={() => toggleSaved(row)} />;
  }

  return (
    <>
      {rowEdits.feedback}
      <PageHeading title={name} description={queue === 'attention' ? 'Review findings before publishing drafts.' : queue === 'not-music' ? 'Browse events whose type is Other.' : all ? 'Review events from all sources.' : avilys ? 'Import and review Vilnius music events from Avilys.' : kakava ? 'Import and review Lithuanian concerts sold on Kakava.' : 'Review imported events and manage the Go Vilnius feed.'} icon={avilys ? 'avilys' : kakava ? 'ticket' : 'calendar'} href={all ? undefined : avilys ? 'https://avilys.app/paieska' : kakava ? 'https://kakava.lt/renginiai/1/koncertai' : 'https://www.vilnius-events.lt/'} linkLabel={`Open ${name}`} tools={!all} />
      {all && !queue && <Metrics items={[
        { label: 'Events across all sources', value: data?.counts.total.toLocaleString() ?? '—', icon: 'calendar' },
        { label: 'Live in the app, not yet past', value: data?.readyCount.toLocaleString() ?? '—', icon: 'check' },
        { label: 'Type not decided (music or other)', value: data?.counts.unsure.toLocaleString() ?? '—', icon: 'filter' },
      ]} />}
      <div className={all ? 'main-stack' : 'workspace-grid'}>
        <div className="main-stack">
          <section className="panel catalogue" ref={catalogue}>
            <PanelHeading title={queue === 'attention' ? 'Open findings' : 'Imported events'} end={savedOnly ? <span className="count-label">{rows.length} saved matching</span> : data && !invalid && <span className="count-label">{data.total.toLocaleString()} matching</span>} />
            <div className="catalogue-tools event-tools">
              <SearchField label="Search by event title" value={query} onChange={value => updateFilters(setQuery, value)} />
              <div className="filter-grid">
                <label className="field">When <select value={when} onChange={event => changeWhen(event.target.value as EventDateFilter)}>
                  {dateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select></label>
                <label className="field">City <select value={city} onChange={event => updateFilters(setCity, event.target.value)}>
                  <option value="all">All cities</option>
                  {(data?.cities ?? []).map(item => <option key={item.city} value={item.city}>{item.city} ({item.count})</option>)}
                  {city !== 'all' && city !== 'none' && !data?.cities?.some(item => item.city === city) && <option value={city}>{city}</option>}
                  <option value="none">No city</option>
                </select></label>
                <label className="field">Price <select value={price} onChange={event => updateFilters(setPrice, event.target.value)}>
                  <option value="all">All prices</option><option value="free">Free</option><option value="paid">Paid</option><option value="unknown">Price unknown</option>
                </select></label>
                <label className="field">Time <select value={time} onChange={event => updateFilters(setTime, event.target.value)}>
                  <option value="all">All times</option><option value="known">Time known</option><option value="unknown">Time unknown</option>
                </select></label>
                {queue !== 'not-music' && <label className="field">Type <select value={review} onChange={event => updateFilters(setReview, event.target.value)}>
                  <option value="all">All types</option>{reviews.map(status => <option key={status} value={status}>{labels[status]}</option>)}
                </select></label>}
                <label className="field">Visibility <select value={publication} onChange={event => updateFilters(setPublication, event.target.value)}>
                  <option value="all">All</option><option value="draft">Draft (hidden)</option><option value="live">Live (in app)</option>
                </select></label>
                <label className="field">Sort by <select value={sort} onChange={event => {
                  const value = event.target.value as typeof sort;
                  if (when === 'newest' && value !== 'date') setWhen('upcoming');
                  updateFilters(setSort, value);
                }}>
                  <option value="date">Event date</option><option value="score-asc">Score: low to high</option><option value="score-desc">Score: high to low</option>
                </select></label>
              </div>
              <div className="date-quick-filters" role="group" aria-label="Quick date filters">
                {quickDateOptions.map(([filter, label]) => <button
                  key={filter}
                  type="button"
                  className={`secondary-button date-filter-button ${when === filter ? 'active' : ''}`}
                  aria-pressed={when === filter}
                  onClick={() => { setFrom(''); setTo(''); changeWhen(filter); }}
                >{label}</button>)}
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
                    <label className="field">AI verification <select value={verification} onChange={event => updateFilters(setVerification, event.target.value)}>
                      <option value="all">All verification statuses</option>{Object.entries(verificationLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
                    </select></label>
                    <label className="field">Assistant review <select value={assistantReview} onChange={event => updateFilters(setAssistantReview, event.target.value)}>
                      <option value="all">All events</option><option value="pending">Needs my check</option>
                    </select></label>
                    {all && <label className="field">Source <select value={sourceFilter} onChange={event => updateFilters(setSourceFilter, event.target.value)}>
                      <option value="all">All sources</option>{data?.sources.map(item => <option key={item.source_key} value={item.source_key}>{sourceNames[item.source_key] ?? item.source_key}</option>)}
                    </select></label>}
                  </div>

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
              {savedEventsError && <Feedback error message={savedEventsError} />}
            </div>
            <div className="selection-bar">
              <label className="checkbox-label"><input type="checkbox" checked={allSelected} ref={element => { if (element) element.indeterminate = !allSelected && rowIds.some(id => selected.includes(id)); }} disabled={!rows.length || loading || bulkPending} onChange={event => setSelection(rowIds, event.target.checked)} /> Select this page</label>
              {selected.length > 0 && <div className="selection-actions">
                <strong>{selected.length} selected</strong>
                {reviews.map(status => <button className="secondary-button" type="button" key={status} disabled={bulkPending || pending.length > 0 || rowEdits.pending.size > 0} onClick={() => void bulkReview(status)}>{labels[status]}</button>)}
                <button className="text-button" type="button" disabled={bulkPending} onClick={() => setSelected([])}>Clear selection</button>
              </div>}
            </div>
            {!!selected.length && <div className="batch-verification"><VerificationRequest eventIds={selected} onQueued={async () => { await verificationJobs.load(); await loadCurrent.current(true); }} /></div>}
            {all && <div className="batch-verification"><VerificationJobs jobs={verificationJobs.jobs} /></div>}
            <div className="catalogue-feedback"><Feedback message={message} error={actionError} /></div>
            {loadError && <div className="catalogue-error"><Feedback message={loadError} error /><button className="secondary-button" type="button" onClick={() => void load()}>Retry</button></div>}
            <div className="event-list" aria-busy={loading}>
              {groups ? groups.map(group => <Fragment key={group.key}>
                <h3 className="event-group-heading">
                  {group.title}{group.dateLabel && <time dateTime={group.key}>{group.dateLabel}</time>}
                </h3>
                {group.events.map(renderEvent)}
              </Fragment>) : rows.map(renderEvent)}
              {!rows.length && !loadError && !invalid && <p className="empty-state" role="status">{loading ? 'Loading events…' : 'No events match these filters.'}</p>}
            </div>
            {!savedOnly && data && !invalid && data.total > pageSize && <Pagination page={data.page} total={data.total} size={pageSize} onChange={next => {
              setPage(next);
              catalogue.current?.scrollIntoView({ block: 'start' });
            }} />}
          </section>
          {!avilys && !kakava && !all && <VilniusNotes />}
        </div>
        {!all && <aside className="context-column" id="import-tools" tabIndex={-1} aria-label="Event source tools">
          {avilys
            ? <AvilysImport jobs={jobs} busy={busy} start={start} verifyAfterImport={verifyAfterImport} setVerifyAfterImport={setVerifyAfterImport} />
            : kakava
            ? <KakavaImport jobs={jobs} busy={busy} start={start} verifyAfterImport={verifyAfterImport} setVerifyAfterImport={setVerifyAfterImport} />
            : <VilniusImport pages={pages} setPages={setPages} includeImages={includeImages} setIncludeImages={setIncludeImages} verifyAfterImport={verifyAfterImport} setVerifyAfterImport={setVerifyAfterImport} nextPage={data?.nextPage} jobs={jobs} busy={busy} run={action => void startVilnius(action)} runs={data?.runs ?? []} />}
          <Feedback message={importDefaultError} error />
          <VerificationJobs jobs={verificationJobs.jobs} />
          <Feedback message={jobError} error />
          <Disclosure className="standalone" title="Bulk review by source">
            <div className="stack">
              <p>Mark every Unsure event from {name} as Music, across all dates and pages.</p>
              <button className="secondary-button" type="button" disabled={bulkPending || pending.length > 0 || rowEdits.pending.size > 0} onClick={() => void bulkReview('music', true)}>Mark all Unsure as Music</button>
            </div>
          </Disclosure>
        </aside>}
      </div>
    </>
  );
}
