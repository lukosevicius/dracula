import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect } from 'react';
import AiEvaluation from './ai-evaluation';
import AiUsage from './ai-usage';
import ArtistPage from './artist';
import EventPage from './event';
import ArtistsPage from './artists';
import EventsPage from './events';
import DuplicatesPage from './duplicates';
import NewArtistsPage, { MatchArtistsPage } from './artist-review';
import ImportLogPage from './import-log';
import { SavedEventsPage, SavedEventsProvider } from './saved-events';
import SettingsPage, { defaultStartPage, validStartPage } from './settings';
import { api } from './data';
import { Workspace } from './workspace';
import { PullToRefresh } from './pull-to-refresh';
import './seeker.css';

const AiRules = lazy(() => import('./ai-rules'));
const path = window.location.pathname;
function StartupPage() {
  useEffect(() => {
    let active = true;
    void api<{ settings: Record<string, unknown> }>('/api/seeker/settings')
      .then(result => {
        const destination = validStartPage(result.settings.start_page) ? result.settings.start_page : defaultStartPage;
        if (!active) return;
        window.location.replace(destination);
      })
      .catch(() => { if (active) window.location.replace(defaultStartPage); });
    return () => { active = false; };
  }, []);
  return <p className="startup-loading" role="status">Opening Seeker…</p>;
}

const page = path === '/' ? <StartupPage />
  : path === '/artists.html' ? <ArtistsPage />
  : path === '/match-artists.html' ? <MatchArtistsPage />
  : path === '/new-artists.html' ? <NewArtistsPage />
  : path === '/import-log.html' ? <ImportLogPage />
  : path === '/artist.html' ? <ArtistPage mbid={new URLSearchParams(window.location.search).get('id') || ''} />
  : path === '/event.html' ? <EventPage id={new URLSearchParams(window.location.search).get('id') || ''} />
  : path === '/settings.html' ? <SettingsPage />
  : path === '/ai-evaluation.html' ? <AiEvaluation />
  : path === '/ai-rules.html' ? <Suspense fallback={<p className="empty-state" role="status">Loading AI rules…</p>}><AiRules /></Suspense>
  : path === '/ai-usage.html' ? <AiUsage />
  : path === '/all-events.html' ? <EventsPage all />
  : path === '/needs-attention.html' ? <EventsPage all queue="attention" />
  : path === '/not-music.html' ? <EventsPage all queue="not-music" />
  : path === '/possible-duplicates.html' ? <DuplicatesPage />
  : path === '/avilys.html' ? <EventsPage avilys />
  : path === '/vilnius-events.html' ? <EventsPage />
  : path === '/saved-events.html' ? <SavedEventsPage />
  : <ArtistsPage />;

createRoot(document.getElementById('root')!).render(<SavedEventsProvider><Workspace>{page}<PullToRefresh /></Workspace></SavedEventsProvider>);
