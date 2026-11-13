import type { ArtistsDashboard, DashboardArtist, MusicBrainzRun } from '../types.js';

const form = document.querySelector<HTMLFormElement>('#import-form');
const limitInput = document.querySelector<HTMLInputElement>('#import-limit');
const artistSearch = document.querySelector<HTMLInputElement>('#artist-search');
const importButtons = [...document.querySelectorAll<HTMLButtonElement>('.import-button')];
const toast = document.querySelector('#toast');
let toastTimer;
let nextOffset = 0;
let totalAvailable = null;
let allArtists: DashboardArtist[] = [];

function formatDate(value: string | null, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return 'Never';
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: options.dateStyle || 'medium',
    ...(options.timeStyle ? { timeStyle: options.timeStyle } : {}),
  }).format(date);
}

function relativeDate(value) {
  if (!value) return 'Run an import to start';
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
    }
  }
  return 'Just now';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
}

function renderArtists(artists: DashboardArtist[]) {
  allArtists = artists;
  filterArtists();
}

function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('lt');
}

function filterArtists() {
  const list = document.querySelector('#artist-list');
  const query = normalizeForSearch(artistSearch.value.trim());
  const visibleArtists = query
    ? allArtists.filter((artist) => normalizeForSearch(artist.name).startsWith(query))
    : allArtists;
  const count = document.querySelector('#artist-count');
  count.textContent = query
    ? `${visibleArtists.length} / ${allArtists.length} artists`
    : `${allArtists.length} ${allArtists.length === 1 ? 'artist' : 'artists'}`;

  if (!allArtists.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">♫</span><strong>Your artist catalogue starts here</strong><span>Use “Get data” to import Lithuanian artists from MusicBrainz.</span></div>';
    return;
  }
  if (!visibleArtists.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">⌕</span><strong>No artists start with “${escapeHtml(artistSearch.value.trim())}”</strong><span>Try another name or clear the search field.</span></div>`;
    return;
  }
  const rows = visibleArtists.map((artist) => {
    const name = escapeHtml(artist.name);
    const type = escapeHtml(artist.artist_type || 'Artist');
    const area = escapeHtml(artist.area || artist.country || '—');
    const date = formatDate(artist.first_seen_at, { dateStyle: 'short' });
    return `<tr>
      <td><a class="artist-name-link" href="${escapeHtml(artist.source_url)}" target="_blank" rel="noreferrer">${name}<span class="artist-type">${type}</span></a></td>
      <td class="artist-area">${area}</td>
      <td>${escapeHtml(date)}</td>
    </tr>`;
  }).join('');
  list.innerHTML = `<table class="artist-table"><thead><tr><th>ARTIST</th><th>AREA</th><th>FIRST SEEN</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRuns(runs: MusicBrainzRun[]) {
  const list = document.querySelector('#run-list');
  if (!runs.length) {
    list.innerHTML = '<div class="empty-activity">No imports yet</div>';
    return;
  }
  list.innerHTML = runs.map((run) => {
    const statusClass = run.status === 'failed' ? 'failed' : run.status === 'running' ? 'running' : '';
    const statusText = run.status === 'failed'
      ? 'Import failed'
      : run.status === 'running'
        ? 'Import in progress'
        : run.mode === 'all'
          ? `Full import · ${Number(run.fetched_count).toLocaleString()} artists`
          : run.mode === 'start'
            ? `From beginning · ${Number(run.fetched_count).toLocaleString()} artists`
            : `Next batch · ${Number(run.fetched_count).toLocaleString()} artists`;
    const added = run.status === 'completed' ? `+${run.added_count}` : '';
    const error = run.error_message ? `<div class="run-failed">${escapeHtml(run.error_message)}</div>` : '';
    return `<div class="activity-row">
      <span class="run-status-dot ${statusClass}"></span>
      <div><div class="run-main">${statusText}</div><div class="run-date">${escapeHtml(formatDate(run.started_at, { dateStyle: 'medium', timeStyle: 'short' }))}</div>${error}</div>
      <span class="run-added">${added}</span>
    </div>`;
  }).join('');
}

function renderDashboard(data: ArtistsDashboard) {
  document.querySelector('#total-artists').textContent = Number(data.totalArtists).toLocaleString();
  const lastRun = data.lastRun;
  nextOffset = Number(data.sourceState?.next_offset || 0);
  totalAvailable = data.sourceState?.total_available == null ? null : Number(data.sourceState.total_available);
  updateBatchPosition();
  if (!lastRun) {
    document.querySelector('#last-run-date').textContent = 'Never';
    document.querySelector('#last-run-relative').textContent = 'Run an import to start';
    document.querySelector('#last-run-added').textContent = '—';
    document.querySelector('#last-run-summary').textContent = 'From the latest import';
  } else {
    document.querySelector('#last-run-date').textContent = formatDate(lastRun.started_at, { dateStyle: 'medium' });
    document.querySelector('#last-run-relative').textContent = relativeDate(lastRun.started_at);
    document.querySelector('#last-run-added').textContent = lastRun.status === 'completed' ? Number(lastRun.added_count).toLocaleString() : '—';
    document.querySelector('#last-run-summary').textContent = lastRun.status === 'completed'
      ? `${Number(lastRun.updated_count).toLocaleString()} existing records refreshed`
      : lastRun.status === 'failed' ? 'The latest import failed' : 'Import is in progress';
  }
  renderArtists(data.artists);
  renderRuns(data.recentRuns);
}

function updateBatchPosition() {
  const batchSize = Number(limitInput.value);
  const amount = Number.isInteger(batchSize) && batchSize > 0 ? batchSize.toLocaleString() : '—';
  document.querySelector('#batch-position').textContent = `Next batch: up to ${amount} Lithuanian artists from MusicBrainz offset ${nextOffset.toLocaleString()}`;
}

async function loadDashboard() {
  const response = await fetch('/api/dashboard');
  if (!response.ok) throw new Error('Could not load the dashboard data.');
  renderDashboard(await response.json());
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter as HTMLButtonElement | null;
  const mode = submitter?.value || 'next';
  const limit = Number(limitInput.value);
  if (mode !== 'all' && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) {
    showToast('Enter a whole number from 1 to 1,000.', true);
    limitInput.focus();
    return;
  }
  const originalLabel = submitter?.innerHTML;
  importButtons.forEach((button) => { button.disabled = true; });
  if (submitter) submitter.innerHTML = '<span class="button-icon" aria-hidden="true">↻</span><span>Importing…</span>';
  try {
    const response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, limit }),
    });
    const result = await response.json();
    if (result.dashboard) renderDashboard(result.dashboard);
    if (!response.ok) throw new Error(result.error || 'The import failed.');
    const { addedCount, updatedCount, fetchedCount, totalAvailable: matchedCount } = result.result;
    const action = mode === 'all' ? 'Full import complete' : mode === 'start' ? 'Batch from the beginning complete' : 'Next batch complete';
    const suffix = matchedCount !== null && fetchedCount < limit && mode !== 'all' ? ` (${matchedCount.toLocaleString()} matched in total)` : '';
    showToast(`${action} — fetched ${fetchedCount}, added ${addedCount}, refreshed ${updatedCount}${suffix}.`);
  } catch (error) {
    await loadDashboard().catch(() => {});
    showToast(error.message || 'Could not reach MusicBrainz.', true);
  } finally {
    importButtons.forEach((button) => { button.disabled = false; });
    if (submitter && originalLabel) submitter.innerHTML = originalLabel;
  }
});

limitInput.addEventListener('input', updateBatchPosition);
artistSearch.addEventListener('input', filterArtists);

loadDashboard().catch((error) => showToast(error.message, true));
