import type { ProfilesResponse } from './verification';
import { useEffect, useState } from 'react';
import type { ImportRun, MusicBrainzRun } from '../../types';
import { api, errorMessage, formatDate, isActive, jobLabels, safeUrl, type Job } from './data';
import { Disclosure, Feedback, Icon, Pagination, PanelHeading } from './workspace';

export function RecentJobs({ jobs, source }: { jobs: Job[]; source: string }) {
  const recent = jobs.filter(job => job.source === source).slice(0, 4);
  const active = recent.find(isActive);
  return (
    <Disclosure title={<span className="disclosure-caption">Recent jobs {active && <span className={`job-status status-${active.status}`}>{active.status}</span>}</span>}>
      <div className="job-activity">
        {recent.length ? recent.map(job => {
          let progress: Record<string, unknown> = {};
          try { progress = JSON.parse(job.progress_json) ?? {}; } catch { /* Progress is optional. */ }
          const summary = job.action === 'refresh-all-details' && typeof progress.checked === 'number' && typeof progress.total === 'number'
            ? `${progress.checked} of ${progress.total} checked`
            : Object.entries(progress).filter(([, value]) => typeof value === 'number').map(([key, value]) => `${value} ${key.replaceAll('_', ' ')}`).join(' · ');
          return (
            <div className="activity-item" key={job.id}>
              <div><strong>{jobLabels[job.action] ?? job.action}</strong><span className={`job-status status-${job.status}`}>{job.status}</span></div>
              <small>{job.error_message || summary || formatDate(job.started_at, true)}</small>
            </div>
          );
        }) : <p className="muted">No jobs to show.</p>}
      </div>
    </Disclosure>
  );
}

export function ImportHistory({ runs }: { runs: (ImportRun | MusicBrainzRun)[] }) {
  return runs.length ? (
    <div className="job-activity">
      {runs.map((run, index) => (
        <div className="activity-item" key={`${run.started_at}-${index}`}>
          <div><strong>{'mode' in run ? jobLabels[run.mode] + ' · ' : ''}{formatDate(run.started_at, true)}</strong><span className={`job-status status-${run.status}`}>{run.status}</span></div>
          <small>{run.fetched_count} fetched · {run.added_count} added · {run.updated_count} updated</small>
          {run.error_message && <small className="error-text">{run.error_message}</small>}
        </div>
      ))}
    </div>
  ) : <p className="muted">No imports recorded.</p>;
}

export function MusicBrainzNotes() {
  return (
    <Disclosure title="MusicBrainz source notes" className="standalone" id="musicbrainz-source-notes">
      <p>Seeker imports artists whose main associated country is Lithuania (<code>LT</code>). Artist MBIDs link to their releases and genre data.</p>
      <p>MusicBrainz allows up to 100 records per request. Seeker spaces requests at least two seconds apart and browses by area to go beyond the search endpoint’s 500-result cap.</p>
      <ul className="resource-list">
        <li>Browse artists <code>/artist/?area=0785dc14-96af-3dc4-bde4-dcdfc2e2d0d6&amp;fmt=json&amp;limit=100&amp;offset=0</code></li>
        <li>Look up an artist <code>/artist/&#123;MBID&#125;?inc=genres&amp;fmt=json</code></li>
        <li>Browse releases <code>/release-group?artist=&#123;MBID&#125;&amp;limit=100&amp;offset=0&amp;fmt=json</code></li>
      </ul>
      <div className="link-list">
        <a href="https://musicbrainz.org/doc/MusicBrainz_API" target="_blank" rel="noreferrer">API documentation <Icon name="external" size={14} /></a>
        <a href="https://musicbrainz.org/doc/About/Data_License" target="_blank" rel="noreferrer">Data licenses <Icon name="external" size={14} /></a>
      </div>
    </Disclosure>
  );
}

export function VilniusNotes() {
  return (
    <Disclosure title="Vilnius Events source notes" className="standalone">
      <p>The public WordPress API uses category 4 for concerts and 81 for festivals. Seeker checks the event pages for dates, venues and ticket links.</p>
      <ul className="resource-list">
        <li>List events <code>/wp-json/wp/v2/event?per_page=100&amp;page=1</code></li>
        <li>Filter concerts <code>/wp-json/wp/v2/event?categories=4&amp;per_page=100&amp;page=1</code></li>
        <li>Homepage highlights <code>/helpers/json-events/</code></li>
      </ul>
      <div className="link-list">
        <a href="https://www.vilnius-events.lt/wp-json/" target="_blank" rel="noreferrer">REST API index <Icon name="external" size={14} /></a>
        <a href="https://www.vilnius-events.lt/helpers/json-events/" target="_blank" rel="noreferrer">Highlighted events JSON <Icon name="external" size={14} /></a>
        <a href="https://www.vilnius-events.lt/renginiu-talpinimo-taisykles/" target="_blank" rel="noreferrer">Publishing rules <Icon name="external" size={14} /></a>
      </div>
    </Disclosure>
  );
}

function ImportVerificationOption({ checked, onChange }: { checked: boolean | null; onChange: (value: boolean) => void }) {
  const [unconfigured, setUnconfigured] = useState(false);
  useEffect(() => {
    let disposed = false;
    void api<ProfilesResponse>('/api/workflow/providers').then(state => {
      if (!disposed) setUnconfigured(!state.configured || !state.default_id);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);
  return <>
    <label className="checkbox-label"><input type="checkbox" checked={checked ?? false} disabled={checked === null} onChange={event => onChange(event.target.checked)} /> Verify with AI after import</label>
    {checked === null && <p className="muted" role="status">Loading import default…</p>}
    {checked && unconfigured && <p className="muted">Set a default provider in <a href="/settings.html">Settings</a> to verify this import.</p>}
  </>;
}

export function VilniusImport({ pages, setPages, includeImages, setIncludeImages, verifyAfterImport, setVerifyAfterImport, nextPage, jobs, busy, run, runs }: {
  pages: number; setPages: (value: number) => void; includeImages: boolean; setIncludeImages: (value: boolean) => void;
  verifyAfterImport: boolean | null; setVerifyAfterImport: (value: boolean) => void;
  nextPage?: number; jobs: Job[]; busy: boolean; run: (action: string) => void; runs: ImportRun[];
}) {
  const disabled = busy || !Number.isInteger(pages) || pages < 1 || pages > 10;
  const importDisabled = disabled || verifyAfterImport === null;
  return (
    <section className="panel import-panel">
      <PanelHeading icon="download" title="Import events" description={nextPage ? `Next source page · ${nextPage}` : 'Import concerts and festivals'} />
      <div className="panel-body stack">
        <label className="field">Pages per import <input type="number" min="1" max="10" value={pages || ''} onChange={event => setPages(Number(event.target.value))} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={includeImages} onChange={event => setIncludeImages(event.target.checked)} /> Download event images</label>
        <ImportVerificationOption checked={verifyAfterImport} onChange={setVerifyAfterImport} />
        <button className="primary-button" disabled={importDisabled} onClick={() => run('next')}><Icon name="download" />{busy ? 'Source job running…' : 'Get next pages'}</button>
      </div>
      <Disclosure title="More import actions">
        <div className="stack">
          <p>Continuing also refreshes the newest and previous pages.</p>
          <button className="secondary-button" disabled={importDisabled} onClick={() => run('refresh')}>Refresh newest page</button>
          <button className="secondary-button" disabled={importDisabled} onClick={() => run('sample')}>Get 10 events</button>
          <button className="secondary-button" disabled={importDisabled} onClick={() => run('start')}>Start from beginning</button>
        </div>
      </Disclosure>
      <Disclosure title="Images and event details">
        <div className="stack">
          {['download-images', 'details', 'refresh-details', 'refresh-all-details'].map(action => (
            <button className="secondary-button" disabled={disabled} onClick={() => run(action)} key={action}>{jobLabels[action]}</button>
          ))}
        </div>
      </Disclosure>
      <RecentJobs jobs={jobs} source="vilnius-events" />
      <Disclosure title="Import history"><ImportHistory runs={runs} /></Disclosure>
    </section>
  );
}

type Preview = {
  data: { id: number; title: string; startTime: string | null; venueName: string | null; sourceUrl: string | null }[];
  total: number;
};

export function AvilysImport({ jobs, busy, start, verifyAfterImport, setVerifyAfterImport }: {
  jobs: Job[]; busy: boolean;
  start: (source: string, action: string, params: Record<string, unknown>) => Promise<void>;
  verifyAfterImport: boolean | null; setVerifyAfterImport: (value: boolean) => void;
}) {
  const [limit, setLimit] = useState(20);
  const [startPage, setStartPage] = useState(1);
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const valid = Number.isInteger(limit) && limit >= 1 && limit <= 200 && Number.isInteger(startPage) && startPage >= 1 && startPage <= 10000;

  async function load(next: number) {
    setLoading(true);
    setError('');
    try {
      setPreview(await api<Preview>(`/api/avilys/preview?page=${next}`));
      setPage(next);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    setError('');
    try {
      await start('avilys', 'import', { limit, start_page: startPage, verify_after_import: verifyAfterImport === true });
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  return (
    <section className="panel import-panel">
      <PanelHeading icon="download" title="Import events" description="Vilnius music events" />
      <div className="panel-body stack">
        <div className="field-grid">
          <label className="field">Events <input type="number" min="1" max="200" value={limit || ''} onChange={event => setLimit(Number(event.target.value))} /></label>
          <label className="field">Start page <input type="number" min="1" max="10000" value={startPage || ''} onChange={event => setStartPage(Number(event.target.value))} /></label>
        </div>
        <ImportVerificationOption checked={verifyAfterImport} onChange={setVerifyAfterImport} />
        <button className="primary-button" disabled={busy || !valid || verifyAfterImport === null} onClick={() => void run()}><Icon name="download" />{busy ? 'Source job running…' : 'Import events'}</button>
        <button className="secondary-button" disabled={loading} onClick={() => void load(1)}>{loading ? 'Loading preview…' : 'Preview source events'}</button>
        <Feedback message={error} error />
        {preview && (
          <div className="source-preview" aria-busy={loading}>
            <p>Verify dates and times against the event source.</p>
            <ul>{preview.data.map(event => (
              <li key={event.id}>
                <a href={safeUrl(event.sourceUrl) || `https://avilys.app/event/${event.id}`} target="_blank" rel="noreferrer">{event.title}<Icon name="external" size={13} /></a>
                <small>{event.startTime || 'Date unknown'} · {event.venueName || 'Venue unknown'}</small>
              </li>
            ))}</ul>
            <Pagination page={page} total={preview.total} size={20} onChange={next => { if (!loading) void load(next); }} />
          </div>
        )}
      </div>
      <RecentJobs jobs={jobs} source="avilys" />
    </section>
  );
}
