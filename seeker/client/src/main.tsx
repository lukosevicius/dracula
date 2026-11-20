import { createRoot } from 'react-dom/client';
import AiEvaluation from './ai-evaluation';
import ArtistsPage from './artists';
import EventsPage from './events';
import { SavedEventsPage, SavedEventsProvider } from './saved-events';
import { Workspace } from './workspace';
import './seeker.css';

const path = window.location.pathname;
const page = path === '/ai-evaluation.html' ? <AiEvaluation />
  : path === '/avilys.html' ? <EventsPage avilys />
  : path === '/vilnius-events.html' ? <EventsPage />
  : path === '/saved-events.html' ? <SavedEventsPage />
  : <ArtistsPage />;

createRoot(document.getElementById('root')!).render(<SavedEventsProvider><Workspace>{page}</Workspace></SavedEventsProvider>);
