import { useCallback, useEffect, useState } from 'react';
import { api, artistHref, errorMessage, formatDate } from './data';
import { Feedback, PageHeading, PanelHeading } from './workspace';

type Link = { event_id: number; title: string; event_date: string | null; venue: string | null; mbid: string; name: string; artist_type: string | null; area: string | null; disambiguation: string | null; role: string | null; evidence: string | null };
type Mention = { event_id: number; title: string; event_date: string | null; venue: string | null; written: string; role: string; evidence: string };
type NewName = { name: string; role: string; country: string; minor: boolean; events: Mention[] };
type Added = { linked: number; source: 'musicbrainz' | 'dracula'; country: string | null; name: string };
type Stats = { events: number; failed: number; cost_usd: number; last_run: string | null; waiting: number };
type Review = { links: Link[]; new_names: NewName[]; stats: Stats };
type Batch = { processed: number; linked: number; suggested: number; new_names: number; cost_usd: number; remaining: number };

const roleLabels: Record<string, string> = { main: 'Main act', support: 'Support', member: 'Band member', conductor: 'Conductor', ensemble: 'Ensemble', dj: 'DJ', guest: 'Guest', other: 'Performer' };
const plain = (value: string) => value.replace(/&#8211;/g, '–').replace(/&#8222;|&#8220;|&#8221;/g, '"').replace(/&#038;|&amp;/g, '&');
const eventCount = (n: number) => `${n} event${n === 1 ? '' : 's'}`;

function EventLine({ item }: { item: { event_id: number; title: string; event_date: string | null; venue: string | null } }) {
  return <small className="muted"><a href={`/event.html?id=${item.event_id}`}>{plain(item.title)}</a> · {item.event_date ? formatDate(item.event_date) : 'No date'}{item.venue ? ` · ${item.venue}` : ''}</small>;
}

/** The AI step's results, shared by Match artists and New artists, with the button that reads waiting events. */
function useArtistReview() {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState(false);
  const load = useCallback(async () => {
    try { setReview(await api<Review>('/api/workflow/artists/review')); setError(''); window.dispatchEvent(new Event('seeker:artists-changed')); }
    catch (cause) { setError(errorMessage(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function runNow() {
    setRunning(true); setNotice(''); setError('');
    const total = { processed: 0, linked: 0, suggested: 0, new_names: 0, cost_usd: 0 };
    try {
      // One event per request keeps each one well inside Seeker's request time limit. A slow event can still time
      // out; the server keeps whatever it finished, so the loop just carries on, and stops after three failures in a row.
      for (let round = 0, failures = 0; round < 1000; round++) {
        let batch: Batch;
        try { batch = await api<Batch>('/api/workflow/artists/extract', { limit: 1 }); failures = 0; }
        catch (cause) { if (++failures >= 3) throw cause; continue; }
        for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += batch[key];
        setNotice(`Read ${total.processed} events · ${batch.remaining} left…`);
        if (!batch.processed || !batch.remaining) break;
      }
      setNotice(`Read ${eventCount(total.processed)}: ${total.linked} linked, ${total.suggested} to match, ${total.new_names} new names · $${total.cost_usd.toFixed(3)}`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setRunning(false); await load(); }
  }

  const stats = review?.stats;
  const header = (title: string, description: string) => <>
    <PageHeading title={title} icon="spark" description={description}
      actions={<button className="primary-button" type="button" disabled={running} onClick={() => void runNow()}>{running ? 'Reading events…' : stats?.waiting ? `Read ${stats.waiting} waiting events` : 'Check for new events'}</button>} />
    <div className="catalogue-feedback"><Feedback message={error} error /><Feedback message={notice} /></div>
    {stats && <p className="muted">{stats.events} events read by AI{stats.failed ? ` · ${stats.failed} failed` : ''} · {stats.waiting} waiting · total cost ${stats.cost_usd.toFixed(3)}{stats.last_run ? ` · last run ${new Date(stats.last_run).toLocaleString('lt-LT')}` : ''}. New and changed events are also read after each daily import.</p>}
    {!review && !error && <p className="empty-state" role="status">Loading…</p>}
  </>;
  return { review, setReview, load, setError, setNotice, header };
}

/** Review: an artist the AI found for an event, waiting for a quick yes or no. Answered rows leave the list at once. */
export function MatchArtistsPage() {
  const { review, setReview, load, setError, setNotice, header } = useArtistReview();
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  async function decide(link: Link, decision: 'accepted' | 'dismissed') {
    const key = `${link.event_id}:${link.mbid}`;
    setBusy(current => new Set(current).add(key)); setError('');
    try {
      await api(`/api/events/${link.event_id}/artist`, { mbid: link.mbid, decision });
      setReview(current => current && { ...current, links: current.links.filter(item => `${item.event_id}:${item.mbid}` !== key) });
      window.dispatchEvent(new Event('seeker:artists-changed'));
      setNotice(decision === 'accepted' ? `${link.name} linked to ${plain(link.title)}.` : `${link.name} declined for ${plain(link.title)}.`);
    } catch (cause) { setError(errorMessage(cause)); await load(); }
    finally { setBusy(current => { const next = new Set(current); next.delete(key); return next; }); }
  }

  const events = new Map<number, Link[]>();
  for (const link of review?.links ?? []) events.set(link.event_id, [...(events.get(link.event_id) ?? []), link]);
  return <>
    {header('Match artists', 'Artists the AI found for an event that need your check: a one-word name, several artists with the same name, or an unclear part of the listing. Accept links the artist to the event; Decline is remembered.')}
    {review && !events.size && <p className="empty-state">Nothing to match.</p>}
    {[...events.values()].map(links => <section className="panel match-event" key={links[0].event_id}>
      <EventLine item={links[0]} />
      {links.map(link => {
        const key = `${link.event_id}:${link.mbid}`;
        return <div className="artist-match" key={key}>
          <div>
            <a href={artistHref(link.mbid)}><strong>{link.name}</strong></a>
            <small className="artist-match-reason">{[link.role ? roleLabels[link.role] ?? link.role : null, link.disambiguation, link.artist_type, link.area].filter(Boolean).join(' · ')}{link.evidence ? ` · “${link.evidence}”` : ''}</small>
          </div>
          <div className="inline-actions">
            <button className="secondary-button" type="button" disabled={busy.has(key)} onClick={() => void decide(link, 'accepted')}>Accept</button>
            <button className="text-button" type="button" disabled={busy.has(key)} onClick={() => void decide(link, 'dismissed')}>Decline</button>
          </div>
        </div>;
      })}
      <ArtistSearch eventId={links[0].event_id} title={links[0].title} />
    </section>)}
    {review && <EventsWithoutArtists />}
  </>;
}

type Unlinked = { event_id: number; title: string; event_date: string | null; venue: string | null; city: string | null; ai: 'read' | 'waiting' | 'failed'; found: { name: string; outcome: string }[] };
type CatalogueArtist = { mbid: string; name: string; artist_type: string | null; area: string | null };
const outcomeLabels: Record<string, string> = { new: 'not in catalogue', unsure: 'not sure they perform', suggested: 'waiting above', decided: 'declined earlier', linked: 'linked' };
const searchable = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('lt');

/** What the AI found in an event with no linked artist, or why it found nothing. */
function aiNote(event: Unlinked) {
  if (event.ai === 'waiting') return 'AI has not read this event yet.';
  if (event.ai === 'failed') return 'AI could not read this event; it tries again later.';
  if (!event.found.length) return 'AI found no performers in the listing.';
  return `AI found: ${event.found.map(found => `${found.name} (${outcomeLabels[found.outcome] ?? found.outcome})`).join(', ')}`;
}

/** Upcoming music events with no artist yet, each with a quick search to link one from the catalogue. */
function EventsWithoutArtists() {
  const [events, setEvents] = useState<Unlinked[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function show() {
    setLoading(true); setError('');
    try {
      setEvents((await api<{ events: Unlinked[] }>('/api/workflow/artists/unlinked')).events);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }

  if (!events) return <div className="unlinked-toggle">
    <button className="secondary-button" type="button" disabled={loading} onClick={() => void show()}>{loading ? 'Loading events…' : 'Show events without artists'}</button>
    <Feedback message={error} error />
  </div>;
  return <section className="panel">
    <PanelHeading title={`Events without artists (${events.length})`} description="Upcoming music events with no linked artist. Link as many as an event needs: pick one from the catalogue, or add a name that is not in it yet." />
    {!events.length && <p className="empty-state">Every upcoming music event has an artist.</p>}
    {events.map(event => <UnlinkedRow key={event.event_id} event={event} />)}
  </section>;
}

// The catalogue is loaded once per page and shared by every search box.
let catalogue: Promise<CatalogueArtist[]> | null = null;
const loadCatalogue = () => (catalogue ??= api<{ artists: CatalogueArtist[] }>('/api/dashboard').then(result => result.artists).catch(error => { catalogue = null; throw error; }));

/**
 * Links artists to one event by hand, as many as it needs: pick one from the catalogue, or add a name that is not in
 * it yet (looked up in MusicBrainz first, like New artists). Linked names stay listed under the box.
 */
function ArtistSearch({ eventId, title }: { eventId: number; title: string }) {
  const [artists, setArtists] = useState<CatalogueArtist[]>([]);
  const [query, setQuery] = useState('');
  const [linked, setLinked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const needle = searchable(query.trim());
  const matches = needle.length >= 2 ? artists.filter(artist => searchable(artist.name).includes(needle)).slice(0, 8) : [];
  const exact = matches.some(artist => searchable(artist.name) === needle);

  async function save(work: () => Promise<string>) {
    setSaving(true); setError('');
    try { const name = await work(); setLinked(current => [...current, name]); setQuery(''); window.dispatchEvent(new Event('seeker:artists-changed')); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }
  const link = (artist: CatalogueArtist) => save(async () => { await api(`/api/events/${eventId}/artist`, { mbid: artist.mbid, decision: 'accepted' }); return artist.name; });
  const addNew = () => save(async () => {
    const result = await api<{ name: string; source: string; country: string | null }>('/api/workflow/artists/add-to-event', { event_id: eventId, name: query.trim() });
    catalogue = null;
    return `${result.name}${result.source === 'musicbrainz' ? ' (MusicBrainz' + (result.country ? `, ${result.country})` : ')') : ' (new)'}`;
  });

  return <div className="unlinked-search">
    {linked.length > 0 && <small className="linked-names">Linked: {linked.join(', ')}</small>}
    <input type="search" aria-label={`Add an artist to ${plain(title)}`} placeholder="Add an artist…" value={query} disabled={saving}
      onFocus={() => void loadCatalogue().then(setArtists).catch(cause => setError(errorMessage(cause)))}
      onChange={change => setQuery(change.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && needle.length >= 2 && !saving) { event.preventDefault(); if (matches.length === 1) void link(matches[0]); else if (!matches.length) void addNew(); } }} />
    {needle.length >= 2 && <div className="inline-actions">
      {matches.map(artist => <button key={artist.mbid} className="secondary-button" type="button" disabled={saving} onClick={() => void link(artist)}
        title={[artist.artist_type, artist.area].filter(Boolean).join(' · ')}>{artist.name}</button>)}
      {!exact && <button className="text-button" type="button" disabled={saving} onClick={() => void addNew()}>{saving ? 'Adding…' : `+ Add “${query.trim()}” as new artist`}</button>}
    </div>}
    <Feedback message={error} error />
  </div>;
}

function UnlinkedRow({ event }: { event: Unlinked }) {
  return <div className="artist-match unlinked-event">
    <div>
      <EventLine item={event} />
      <small className="artist-match-reason">{aiNote(event)}</small>
      <ArtistSearch eventId={event.event_id} title={event.title} />
    </div>
  </div>;
}

function NewNameRow({ item, busy, onDecide }: { item: NewName; busy: boolean; onDecide: (item: NewName, decision: 'add' | 'dismiss', edit?: { name: string; country: string }) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [country, setCountry] = useState(item.country);
  const first = item.events[0];
  const written = [...new Set(item.events.map(event => event.written).filter(value => value !== item.name))];
  return <div className="artist-match">
    <div>
      {editing ? <div className="inline-actions">
        <input aria-label="Artist name" value={name} onChange={event => setName(event.target.value)} />
        <input aria-label="Country code" value={country} placeholder="Country, e.g. GB" maxLength={2} size={4} onChange={event => setCountry(event.target.value.toUpperCase())} />
      </div> : <strong>{item.name}</strong>}
      <small className="artist-match-reason">{roleLabels[item.role] ?? item.role} · {item.country || 'Country unknown'}{written.length ? ` · written “${written.join('”, “')}”` : ''}{first.evidence ? ` · “${first.evidence}”` : ''}</small>
      <EventLine item={first} />
      {item.events.length > 1 && <small className="muted more-events">and {item.events.length - 1} more event{item.events.length === 2 ? '' : 's'}: {item.events.slice(1, 4).map(event => plain(event.title)).join(' · ')}{item.events.length > 4 ? ' …' : ''}</small>}
    </div>
    <div className="inline-actions">
      <button className="secondary-button" type="button" disabled={busy || (editing && (!name.trim() || (!!country && !/^[A-Z]{2}$/.test(country))))}
        onClick={() => onDecide(item, 'add', editing ? { name: name.trim(), country } : undefined)}>Add artist</button>
      {!editing && <button className="text-button" type="button" disabled={busy} onClick={() => setEditing(true)}>Edit</button>}
      <button className="text-button" type="button" disabled={busy} onClick={() => onDecide(item, 'dismiss')}>Reject</button>
    </div>
  </div>;
}

/** Review: performers with no artist in the catalogue yet, each name once with every event that names it. */
export default function NewArtistsPage() {
  const { review, load, setError, setNotice, header } = useArtistReview();
  const [busy, setBusy] = useState('');

  async function decideName(item: NewName, decision: 'add' | 'dismiss', edit?: { name: string; country: string }) {
    setBusy(item.name); setNotice(''); setError('');
    try {
      const result = await api<Added>('/api/workflow/artists/new', { name: item.name, display_name: edit?.name, country: edit?.country ?? item.country, decision });
      setNotice(decision === 'dismiss' ? `${item.name} rejected on ${eventCount(item.events.length)}.`
        : `${result.name} added${result.source === 'musicbrainz' ? ' from MusicBrainz' : ''}${result.country ? ` (${result.country})` : ''} and linked on ${eventCount(result.linked)}.`);
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  const main = review?.new_names.filter(item => !item.minor) ?? [];
  const minor = review?.new_names.filter(item => item.minor) ?? [];
  return <>
    {header('New artists', 'Performers the AI found that are not in the catalogue yet. Add artist looks the name up in MusicBrainz first, where one clear match brings its real country, and links every upcoming event that names it.')}
    {review && <section className="panel">
      <PanelHeading title={`Headliners, bands and ensembles (${main.length})`} />
      {!main.length && <p className="empty-state">No new names.</p>}
      {main.map(item => <NewNameRow key={item.name} item={item} busy={!!busy} onDecide={decideName} />)}
      {minor.length > 0 && <details className="minor-names">
        <summary>Band members, guests and others ({minor.length})</summary>
        {minor.map(item => <NewNameRow key={item.name} item={item} busy={!!busy} onDecide={decideName} />)}
      </details>}
    </section>}
  </>;
}
