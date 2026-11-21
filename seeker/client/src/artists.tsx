import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArtistsDashboard } from '../../types';
import { api, artistHref, errorMessage, formatDate, isActive, useJobs } from './data';
import { ImportHistory, MusicBrainzNotes, RecentJobs } from './imports';
import { Disclosure, Feedback, Icon, Metrics, PageHeading, Pagination, PanelHeading, SearchField } from './workspace';

const pageSize = 20;
const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('lt');

export default function ArtistsPage() {
  const [data, setData] = useState<ArtistsDashboard | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [loadError, setLoadError] = useState('');
  const [jobError, setJobError] = useState('');
  const catalogue = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setData(await api<ArtistsDashboard>('/api/dashboard'));
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);
  const { jobs, start, startingSource } = useJobs(finished => {
    if (finished.some(job => job.source === 'musicbrainz')) void load();
  });
  useEffect(() => { void load(); }, [load]);

  const busy = startingSource === 'musicbrainz' || jobs.some(job => job.source === 'musicbrainz' && isActive(job));
  const validLimit = Number.isInteger(limit) && limit >= 1 && limit <= 1000;
  const artists = useMemo(() => {
    const prefix = normalize(query.trim());
    return (data?.artists ?? []).filter(artist => normalize(artist.name).startsWith(prefix));
  }, [data, query]);
  const visiblePage = Math.min(page, Math.max(1, Math.ceil(artists.length / pageSize)));
  const visibleArtists = artists.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);

  async function run(action: string) {
    setJobError('');
    try {
      await start('musicbrainz', action, { limit });
    } catch (error) {
      setJobError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeading title="Artist catalogue" description="Browse Lithuanian artists and import new records from MusicBrainz." icon="library" href="https://musicbrainz.org/" linkLabel="Open MusicBrainz" tools />
      <Metrics items={[
        { label: 'Artists in catalogue', value: data?.totalArtists.toLocaleString() ?? '—', icon: 'library' },
        { label: 'Added last import', value: data?.lastRun?.added_count.toLocaleString() ?? '—', icon: 'plus' },
        { label: 'Last import', value: data ? (data.lastRun ? formatDate(data.lastRun.started_at) : 'Never') : '—', icon: 'clock' },
      ]} />
      <div className="workspace-grid">
        <div className="main-stack">
          <section className="panel catalogue" ref={catalogue}>
            <PanelHeading title="Artists" end={data && <span className="count-label">{artists.length.toLocaleString()} {query.trim() ? 'matching' : 'artists'}</span>} />
            <div className="catalogue-tools">
              <SearchField label="Search by artist name" value={query} onChange={value => { setQuery(value); setPage(1); }} />
            </div>
            {loadError && <div className="catalogue-error"><Feedback message={loadError} error /><button className="secondary-button" onClick={() => void load()}>Retry</button></div>}
            {!data && !loadError && <p className="empty-state" role="status">Loading artists…</p>}
            {data && !visibleArtists.length && <p className="empty-state">{query.trim() ? 'No artists match your search.' : 'Import a batch from MusicBrainz to start the catalogue.'}</p>}
            {visibleArtists.length > 0 && (
              <div className="table-wrap">
                <table className="artist-table">
                  <thead><tr><th scope="col">Artist</th><th scope="col">Area</th><th scope="col">First seen</th></tr></thead>
                  <tbody>{visibleArtists.map(artist => (
                    <tr key={artist.mbid}>
                      <td>
                        <a className="artist-link" href={artistHref(artist.mbid)}><strong>{artist.name}</strong><Icon name="chevron" size={13} /></a>
                        <small>{artist.artist_type || 'Artist'}</small>
                      </td>
                      <td>{artist.area || artist.country || '—'}</td>
                      <td>{artist.first_seen_at ? formatDate(artist.first_seen_at) : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {data && artists.length > pageSize && <Pagination page={visiblePage} total={artists.length} size={pageSize} onChange={next => {
              setPage(next);
              catalogue.current?.scrollIntoView({ block: 'start' });
            }} />}
          </section>
          <MusicBrainzNotes />
        </div>
        <aside className="context-column" id="import-tools" tabIndex={-1} aria-label="MusicBrainz import tools">
          <section className="panel import-panel">
            <PanelHeading icon="download" title="Import artists" description="MusicBrainz" />
            <div className="panel-body stack">
              <label className="field">Batch size <input type="number" min="1" max="1000" value={limit || ''} onChange={event => setLimit(Number(event.target.value))} /></label>
              <button className="primary-button" disabled={!validLimit || busy} onClick={() => void run('next')}><Icon name="download" />{busy ? 'Import in progress…' : 'Get next batch'}</button>
              {data && <p className="import-position">Next source offset <strong>{(data.sourceState?.next_offset ?? 0).toLocaleString()}</strong></p>}
              <Feedback message={jobError} error />
            </div>
            <Disclosure title="More import actions">
              <div className="stack">
                <button className="secondary-button" disabled={!validLimit || busy} onClick={() => void run('start')}>Start from beginning</button>
                <button className="secondary-button" disabled={busy} onClick={() => void run('all')}>Import all artists</button>
              </div>
            </Disclosure>
            <RecentJobs jobs={jobs} source="musicbrainz" />
            <Disclosure title="Import history"><ImportHistory runs={data?.recentRuns ?? []} /></Disclosure>
          </section>
        </aside>
      </div>
    </>
  );
}
