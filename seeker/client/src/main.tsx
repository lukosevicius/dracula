import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import AiEvaluation from './ai-evaluation';
import ArtistPage from './artist';
import ArtistsPage from './artists';
import EventsPage from './events';
import { SavedEventsPage, SavedEventsProvider } from './saved-events';
import SettingsPage, { defaultStartPage, validStartPage } from './settings';
import { api } from './data';
import { Workspace } from './workspace';
import { PullToRefresh } from './pull-to-refresh';
import './seeker.css';

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
  : path === '/artist.html' ? <ArtistPage mbid={new URLSearchParams(window.location.search).get('id') || ''} />
  : path === '/settings.html' ? <SettingsPage />
  : path === '/ai-evaluation.html' ? <AiEvaluation />
  : path === '/avilys.html' ? <EventsPage avilys />
  : path === '/vilnius-events.html' ? <EventsPage />
  : path === '/saved-events.html' ? <SavedEventsPage />
  : <ArtistsPage />;

createRoot(document.getElementById('root')!).render(<SavedEventsProvider><Workspace>{page}<PullToRefresh /></Workspace></SavedEventsProvider>);
