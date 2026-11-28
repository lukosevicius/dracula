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
    </section>)}
  </>;
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
