import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ArtistsDashboard, DashboardArtist, EventRecord, ReviewStatus } from '../../types';
import { api, artistHref, errorMessage, formatDate, labels, priceInfo, reviews, safeUrl, sourceNames, type EventRow } from './data';
import { Description } from './event-description';
import { Feedback, Icon } from './workspace';

type EventDetailsResponse = {
  event: EventRecord & { source_timestamp?: string | null };
  image: { media_id?: number; source_id?: string; source_key?: string; width: number | null; height: number | null; source_url: string } | null;
  sources: { source_key: string; source_url: string }[];
  matches: { id: number; title: string; event_date: string; venue: string | null; venue_matches: boolean }[];
};

const detailsFields = [
  ['event_date', 'Event date', 'date'],
  ['event_end_date', 'Calendar end date', 'date'],
  ['event_time', 'Time', 'time'],
  ['venue', 'Venue', 'text'],
  ['ticket_url', 'Ticket URL', 'url'],
] as const;

type DetailsDraft = Partial<Record<(typeof detailsFields)[number][0], string>> & { review_status?: ReviewStatus };

function manualFields(value: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const normalizeArtistName = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('lt');

export default function EventEditor({ row, today, onSaved, onRefresh, refreshing }: {
  row: EventRow; today: string; onSaved: () => Promise<void>; onRefresh: () => void; refreshing: boolean;
}) {
  const [info, setInfo] = useState<EventDetailsResponse | null>(null);
  const [draft, setDraft] = useState<DetailsDraft>({});
  const [priceDraft, setPriceDraft] = useState<{ text?: string; type?: NonNullable<EventRecord['price_type']> }>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [artistQuery, setArtistQuery] = useState('');
  const [artists, setArtists] = useState<DashboardArtist[] | null>(null);
  const [artistsLoading, setArtistsLoading] = useState(false);
  const [artistsError, setArtistsError] = useState('');
  const id = row.id;
  const lastChecked = row.details_checked_at;

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setInfo(await api<EventDetailsResponse>(`/api/events/${id}/details`));
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [id]);
  useEffect(() => { void load(); }, [load, lastChecked]);
  useEffect(() => { setDraft(current => ({ ...current, review_status: undefined })); }, [row.review_status]);

  const storedPrice = priceInfo(row);
  const priceText = priceDraft.text ?? storedPrice.text;
  const priceType = priceDraft.type ?? storedPrice.type;
  const fields = Object.fromEntries(detailsFields.map(([name]) => [name, draft[name] ?? row[name] ?? '']));
  const review = draft.review_status ?? row.review_status;
  const manual = manualFields(info?.event.manual_fields);
  const tickets = safeUrl(row.ticket_url);
  const about = safeUrl(row.about_url);
  const original = safeUrl(row.source_url);
  const image = info?.image;
  const publicEvent = row.review_status === 'music' && (!row.event_date || (row.event_end_date || row.event_date) >= today);
  const matchedArtists = useMemo(() => {
    const query = normalizeArtistName(artistQuery.trim());
    if (!query || !artists) return [];
    const alreadyLinked = new Set(info?.event.artist_links.map(artist => artist.artist_mbid) ?? []);
    return artists.filter(artist => !alreadyLinked.has(artist.mbid) && normalizeArtistName(artist.name).includes(query)).slice(0, 12);
  }, [artistQuery, artists, info]);

  const loadArtists = useCallback(async () => {
    if (artists || artistsLoading) return;
    setArtistsLoading(true);
    setArtistsError('');
    try {
      const dashboard = await api<ArtistsDashboard>('/api/dashboard');
      setArtists(dashboard.artists);
    } catch (error) {
      setArtistsError(errorMessage(error));
    } finally {
      setArtistsLoading(false);
    }
  }, [artists, artistsLoading]);

  async function saveRequest(action: string, body: unknown, afterSave: () => void | Promise<void>, success: string) {
    setSaving(true);
    setMessage('');
    setSaveError(false);
    try {
      await api(`/api/events/${id}/${action}`, body);
      await afterSave();
      setMessage(success);
    } catch (error) {
      setSaveError(true);
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function saveDetails(event: FormEvent) {
    event.preventDefault();
    void saveRequest('details', { ...fields, review_status: review }, async () => {
      await onSaved();
      await load();
      setDraft({});
    }, 'Event details saved.');
  }

  function savePrice(event: FormEvent) {
    event.preventDefault();
    void saveRequest('price', { price_text: priceText, price_type: priceType }, async () => {
      await onSaved();
      setPriceDraft({});
    }, 'Price saved.');
  }

  function decideArtist(mbid: string, decision: string) {
    void saveRequest('artist', { mbid, decision }, load, 'Artist review saved.');
  }

  function assignArtist(artist: DashboardArtist) {
    setArtistQuery('');
    decideArtist(artist.mbid, 'accepted');
  }

  return (
    <div className="event-editor">
      <div className="editor-top">
        <h3>Event details</h3>
        <div className="link-list">
          {publicEvent && <a href={`https://app.dracula.lt/events/${row.id}`} target="_blank" rel="noreferrer">View in Dracula <Icon name="external" size={13} /></a>}
          {tickets && <a href={tickets} target="_blank" rel="noreferrer"><Icon name="ticket" size={15} /> Tickets <Icon name="external" size={13} /></a>}
          {about && <a href={about} target="_blank" rel="noreferrer">Event information <Icon name="external" size={13} /></a>}
          {original && !info?.sources.length && <a href={original} target="_blank" rel="noreferrer">Original listing <Icon name="external" size={13} /></a>}
          {info?.sources.map(source => {
            const url = safeUrl(source.source_url);
            return url && <a key={`${source.source_key}-${url}`} href={url} target="_blank" rel="noreferrer">{sourceNames[source.source_key] ?? source.source_key} <Icon name="external" size={13} /></a>;
          })}
        </div>
      </div>
      {row.source_key === 'avilys' && <p className="editor-note">Avilys source start time: {info?.event.source_timestamp || 'unavailable'}</p>}
      <form className="editor-form" onSubmit={saveDetails}>
        {detailsFields.map(([name, label, type]) => (
          <label className="field" key={name}>
            <span>{label}{manual.includes(name) && <small> · Manual</small>}</span>
            <input type={type} value={fields[name]} disabled={saving} onChange={event => setDraft(current => ({ ...current, [name]: event.target.value }))} />
          </label>
        ))}
        <label className="field">Review status
          <select value={review} disabled={saving} onChange={event => setDraft(current => ({ ...current, review_status: event.target.value as ReviewStatus }))}>
            {reviews.map(value => <option key={value} value={value}>{labels[value]}</option>)}
          </select>
        </label>
        <button className="primary-button" disabled={saving}>Save details</button>
      </form>
      <form className="editor-form editor-price" onSubmit={savePrice}>
        <label className="field">Price text <input value={priceText} disabled={saving} placeholder="e.g. Nuo 15 €" maxLength={300} onChange={event => setPriceDraft(current => ({ ...current, text: event.target.value }))} /></label>
        <label className="field">Price type
          <select value={priceType} disabled={saving} onChange={event => setPriceDraft(current => ({ ...current, type: event.target.value as typeof priceType }))}>
            <option value="unknown">Unknown</option><option value="free">Free</option><option value="paid">Paid</option>
          </select>
        </label>
        <button className="secondary-button" disabled={saving}>Save price</button>
      </form>
      <Feedback message={message} error={saveError} />
      <div className="editor-refresh">
        <small>{lastChecked ? `Source checked ${formatDate(lastChecked, true)}` : 'Source details need checking.'}</small>
        {row.source_key === 'vilnius-events' && <button className="text-button" type="button" disabled={refreshing || saving} onClick={onRefresh}>Refresh source details</button>}
      </div>
      {loadError && <div className="editor-error"><Feedback message={loadError} error /><button type="button" className="secondary-button" onClick={() => void load()}>Retry details</button></div>}
      {!info && !loadError && <p role="status" className="muted">Loading artists and source details…</p>}
      {info && (
        <>
          <section className="editor-section">
            <h3>Artist matches</h3>
            <div className="artist-search-select">
              <label className="field">Assign artist from catalogue
                <div className="search-field">
                  <Icon name="search" size={15} />
                  <input type="search" value={artistQuery} placeholder="Search artists…" role="combobox" aria-autocomplete="list" aria-expanded={!!artistQuery.trim()} aria-controls={artistQuery.trim() ? 'artist-search-options' : undefined} onFocus={() => void loadArtists()} onChange={event => { setArtistQuery(event.target.value); void loadArtists(); }} />
                </div>
              </label>
              {!!artistQuery.trim() && <div className="artist-search-options" id="artist-search-options" role="listbox" aria-label="Artist search results">
                {artistsLoading && <p className="muted">Loading artists…</p>}
                {!artistsLoading && artistsError && <div className="artist-search-error"><p className="error-text">{artistsError}</p><button className="text-button" type="button" onClick={() => void loadArtists()}>Retry</button></div>}
                {!artistsLoading && !artistsError && !matchedArtists.length && <p className="muted">No artists found.</p>}
                {!artistsLoading && matchedArtists.map(artist => <button className="artist-search-option" type="button" role="option" aria-selected="false" key={artist.mbid} disabled={saving} onClick={() => assignArtist(artist)}>
                  <strong>{artist.name}</strong><small>{artist.artist_type || 'Artist'}{artist.area ? ` · ${artist.area}` : ''}</small>
                </button>)}
                {!artistsLoading && matchedArtists.length === 12 && <p className="artist-search-hint">Showing the first 12 results. Type more to narrow the list.</p>}
              </div>}
            </div>
            <p className="muted">Confirmed artists · {info.event.artist_links.length ? info.event.artist_links.map((artist, index) => (
              <span key={artist.artist_mbid}>{index > 0 && ', '}<a href={artistHref(artist.artist_mbid)}>{artist.name}</a></span>
            )) : 'None'}</p>
            {info.event.artist_links.length > 0 && <div className="inline-actions">{info.event.artist_links.map(artist => (
              <button key={artist.artist_mbid} type="button" className="secondary-button" disabled={saving} onClick={() => decideArtist(artist.artist_mbid, 'remove')}>Remove {artist.name}</button>
            ))}</div>}
            {!info.event.artist_suggestions.length && <p className="muted">No suggested artist matches.</p>}
            {info.event.artist_suggestions.map(artist => (
              <div className="artist-match" key={artist.mbid}>
                <div><a href={artistHref(artist.mbid)}><strong>{artist.name}</strong></a><small className="artist-match-reason">Matched in {artist.reason.toLocaleLowerCase()}</small></div>
                <div className="inline-actions">
                  <button className="secondary-button" type="button" disabled={saving} onClick={() => decideArtist(artist.mbid, 'accepted')}>Accept</button>
                  <button className="text-button" type="button" disabled={saving} onClick={() => decideArtist(artist.mbid, 'dismissed')}>Dismiss</button>
                </div>
              </div>
            ))}
          </section>
          {info.matches.length > 0 && <section className="editor-section">
            <h3>Possible duplicate events</h3>
            <ul>{info.matches.map(match => <li key={match.id}>{match.title} · {formatDate(match.event_date)} · {match.venue || 'Venue unknown'}{match.venue_matches ? ' · Same venue' : ''}</li>)}</ul>
          </section>}
          <section className="editor-section">
            <h3>Source description</h3>
            <Description html={info.event.content_html} sourceUrl={row.source_url} />
            {image && (
              <figure className="event-image">
                <img src={image.source_key === 'avilys' ? `/api/avilys-images/${encodeURIComponent(image.source_id || row.source_id)}` : `/api/vilnius-images/${image.media_id}`} alt="" loading="lazy" />
                <figcaption>Downloaded source image{image.width && image.height ? ` · ${image.width} × ${image.height}` : ''} · <a href={safeUrl(image.source_url)} target="_blank" rel="noreferrer">Open original</a></figcaption>
              </figure>
            )}
          </section>
        </>
      )}
    </div>
  );
}
