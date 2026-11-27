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

function EventLine({ item }: { item: { event_id: number; title: string; event_date: string | null; venue: string | null } }) {
  return <small className="muted"><a href={`/event.html?id=${item.event_id}`}>{plain(item.title)}</a> · {item.event_date ? formatDate(item.event_date) : 'No date'}{item.venue ? ` · ${item.venue}` : ''}</small>;
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
      {item.events.length > 1 && <small className="muted">and {item.events.length - 1} more event{item.events.length === 2 ? '' : 's'}: {item.events.slice(1, 4).map(event => plain(event.title)).join(' · ')}{item.events.length > 4 ? ' …' : ''}</small>}
    </div>
    <div className="inline-actions">
      <button className="secondary-button" type="button" disabled={busy || (editing && (!name.trim() || (!!country && !/^[A-Z]{2}$/.test(country))))}
        onClick={() => onDecide(item, 'add', editing ? { name: name.trim(), country } : undefined)}>Add artist</button>
      {!editing && <button className="text-button" type="button" disabled={busy} onClick={() => setEditing(true)}>Edit</button>}
      <button className="text-button" type="button" disabled={busy} onClick={() => onDecide(item, 'dismiss')}>Reject</button>
    </div>
  </div>;
}

export default function ArtistReviewPage() {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try { setReview(await api<Review>('/api/workflow/artists/review')); setError(''); }
    catch (cause) { setError(errorMessage(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key); setNotice(''); setError('');
    try { await work(); setNotice(done); await load(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }
  const decideLink = (link: Link, decision: 'accepted' | 'dismissed') => act(`${link.event_id}:${link.mbid}`,
    () => api(`/api/events/${link.event_id}/artist`, { mbid: link.mbid, decision }), decision === 'accepted' ? `${link.name} linked.` : `${link.name} rejected for this event.`);
  async function decideName(item: NewName, decision: 'add' | 'dismiss', edit?: { name: string; country: string }) {
    setBusy(`new:${item.name}`); setNotice(''); setError('');
    try {
      const result = await api<Added>('/api/workflow/artists/new', { name: item.name, display_name: edit?.name, country: edit?.country ?? item.country, decision });
      const events = (n: number) => `${n} event${n === 1 ? '' : 's'}`;
      setNotice(decision === 'dismiss' ? `${item.name} rejected on ${events(item.events.length)}.`
        : `${result.name} added${result.source === 'musicbrainz' ? ' from MusicBrainz' : ''}${result.country ? ` (${result.country})` : ''} and linked on ${events(result.linked)}.`);
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  async function runNow() {
    setRunning(true); setNotice(''); setError('');
    const total = { processed: 0, linked: 0, suggested: 0, new_names: 0, cost_usd: 0 };
    try {
      for (let round = 0; round < 200; round++) {
        const batch = await api<Batch>('/api/workflow/artists/extract', { limit: 5 });
        for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += batch[key];
        setNotice(`Read ${total.processed} events · ${batch.remaining} left…`);
        if (!batch.processed || !batch.remaining) break;
      }
      setNotice(`Read ${total.processed} events: ${total.linked} linked, ${total.suggested} to confirm, ${total.new_names} new names · $${total.cost_usd.toFixed(3)}`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setRunning(false); await load(); }
  }

  const stats = review?.stats;
  return <>
    <PageHeading title="Artists to confirm" icon="spark"
      description="AI reads each upcoming music event and lists its performers. Clear matches are linked automatically; the rest wait here. Your answers are remembered."
      actions={<button className="primary-button" type="button" disabled={running} onClick={() => void runNow()}>{running ? 'Reading events…' : stats?.waiting ? `Read ${stats.waiting} waiting events` : 'Check for new events'}</button>} />
    <div className="catalogue-feedback"><Feedback message={error} error /><Feedback message={notice} /></div>
    {stats && <p className="muted">{stats.events} events read{stats.failed ? ` · ${stats.failed} failed` : ''} · {stats.waiting} waiting · total cost ${stats.cost_usd.toFixed(3)}{stats.last_run ? ` · last run ${new Date(stats.last_run).toLocaleString('lt-LT')}` : ''}. New and changed events are also read after each daily import.</p>}
    {!review && !error && <p className="empty-state" role="status">Loading…</p>}
    {review && <>
      <section className="panel">
        <PanelHeading title={`Possible links (${review.links.length})`} description="The AI found this performer and the name matches an artist, but it needs your check: a one-word name, several artists with that name, or an unclear part in the event." />
        {!review.links.length && <p className="empty-state">Nothing to confirm.</p>}
        {review.links.map(link => <div className="artist-match" key={`${link.event_id}:${link.mbid}`}>
          <div>
            <a href={artistHref(link.mbid)}><strong>{link.name}</strong></a>
            <small className="artist-match-reason">{[link.role ? roleLabels[link.role] ?? link.role : null, link.disambiguation, link.artist_type, link.area].filter(Boolean).join(' · ')}{link.evidence ? ` · “${link.evidence}”` : ''}</small>
            <EventLine item={link} />
          </div>
          <div className="inline-actions">
            <button className="secondary-button" type="button" disabled={!!busy} onClick={() => void decideLink(link, 'accepted')}>Confirm</button>
            <button className="text-button" type="button" disabled={!!busy} onClick={() => void decideLink(link, 'dismissed')}>Reject</button>
          </div>
        </div>)}
      </section>
      <section className="panel">
        <PanelHeading title={`New artists (${review.new_names.filter(item => !item.minor).length})`} description="Performers with no artist in the catalogue yet. Add artist looks the name up in MusicBrainz first; one clear match brings its real country. It links every upcoming event that names it." />
        {!review.new_names.some(item => !item.minor) && <p className="empty-state">No new names.</p>}
        {review.new_names.filter(item => !item.minor).map(item => <NewNameRow key={item.name} item={item} busy={!!busy} onDecide={decideName} />)}
        {review.new_names.some(item => item.minor) && <details className="minor-names">
          <summary>Band members, guests and others ({review.new_names.filter(item => item.minor).length})</summary>
          {review.new_names.filter(item => item.minor).map(item => <NewNameRow key={item.name} item={item} busy={!!busy} onDecide={decideName} />)}
        </details>}
      </section>
    </>}
  </>;
}
