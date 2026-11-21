import { useState, useEffect } from 'react';
import type { ArtistConcert, SeekerArtistDetail } from '../../types';
import { api, errorMessage, formatDate, plainText, safeUrl } from './data';
import { Feedback, Icon, PageHeading, PanelHeading } from './workspace';

function Concerts({ title, concerts }: { title: string; concerts: ArtistConcert[] }) {
  return (
    <section className="panel">
      <PanelHeading title={title} end={<span className="count-label">{concerts.length.toLocaleString()}</span>} />
      {concerts.length ? (
        <div className="table-wrap">
          <table className="artist-table" aria-label={title}>
            <thead><tr><th scope="col">Concert</th><th scope="col">Venue</th><th scope="col">Date</th></tr></thead>
            <tbody>{concerts.map(concert => (
              <tr key={concert.id}>
                <td><strong>{plainText(concert.title)}</strong></td>
                <td>{concert.venue || '—'}</td>
                <td>
                  {concert.event_date ? formatDate(concert.event_date) : 'Unknown'}
                  {concert.event_end_date && concert.event_end_date !== concert.event_date && <small>Until {formatDate(concert.event_end_date)}</small>}
                  {concert.event_time && <small>{concert.event_time}</small>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="empty-state">No {title.toLowerCase()} found.</p>}
    </section>
  );
}

export default function ArtistPage({ mbid }: { mbid: string }) {
  const [detail, setDetail] = useState<SeekerArtistDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!mbid) return;
    let active = true;
    void api<SeekerArtistDetail>(`/api/artists/${encodeURIComponent(mbid)}`)
      .then(result => { if (active) setDetail(result); })
      .catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [mbid, attempt]);

  return (
    <div className="main-stack">
      <div><a className="secondary-button" href="/artists.html"><Icon name="left" size={14} /> Artists</a></div>
      {!mbid ? <Feedback message="Artist ID is missing." error /> : error ? (
        <div className="catalogue-error">
          <Feedback message={error} error />
          <button className="secondary-button" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button>
        </div>
      ) : !detail ? <p className="empty-state" role="status">Loading artist…</p> : (
        <>
          <PageHeading
            title={detail.artist.name}
            description={[
              detail.artist.artist_type || 'Artist',
              detail.artist.area || detail.artist.country,
              detail.artist.first_seen_at ? `Added to Seeker ${formatDate(detail.artist.first_seen_at)}` : null,
            ].filter(Boolean).join(' · ')}
            icon="library"
            href={safeUrl(detail.artist.source_url)}
            linkLabel="Open in MusicBrainz"
          />
          <Concerts title="Upcoming concerts" concerts={detail.upcoming} />
          <Concerts title="Past concerts" concerts={detail.past} />
          {!!detail.undated.length && <Concerts title="Concerts without dates" concerts={detail.undated} />}
        </>
      )}
    </div>
  );
}
