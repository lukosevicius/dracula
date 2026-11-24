import { AgentSettings, ProviderSettings } from './workflow-settings';
import { useEffect, useState } from 'react';
import { api, errorMessage } from './data';
import { Feedback, PageHeading } from './workspace';

export const startPages = [
  { path: '/avilys.html', label: 'Avilys' },
  { path: '/all-events.html', label: 'All events' },
  { path: '/needs-attention.html', label: 'Needs attention' },
  { path: '/not-music.html', label: 'Not music' },
  { path: '/possible-duplicates.html', label: 'Possible duplicates' },
  { path: '/artists.html', label: 'Artists' },
  { path: '/saved-events.html', label: 'Saved events' },
  { path: '/vilnius-events.html', label: 'Vilnius Events' },
  { path: '/ai-evaluation.html', label: 'AI evaluation' },
] as const;

export type StartPage = typeof startPages[number]['path'];
export const defaultStartPage: StartPage = '/avilys.html';

const bookmarklet = "javascript:(()=>{const m=location.hostname==='app.dracula.lt'&&location.pathname.match(/^\\/events\\/([1-9]\\d{0,11})\\/?$/);if(m)window.open('https://seeker.dracula.lt/event.html?id='+m[1],'_blank','noopener');else alert('Open an event on app.dracula.lt first.');})()";

export function validStartPage(value: unknown): value is StartPage {
  return startPages.some(page => page.path === value);
}

export default function SettingsPage() {
  const [startPage, setStartPage] = useState<StartPage>(defaultStartPage);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void api<{ settings: Record<string, unknown> }>('/api/seeker/settings')
      .then(result => {
        if (active && validStartPage(result.settings.start_page)) setStartPage(result.settings.start_page);
      })
      .catch(cause => {
        if (active) { setError(true); setMessage(errorMessage(cause)); }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save() {
    setSaving(true);
    setError(false);
    setMessage('');
    try {
      await api('/api/seeker/settings', { key: 'start_page', value: startPage });
      setMessage('Startup page saved.');
    } catch (cause) {
      setError(true);
      setMessage(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <PageHeading title="Settings" description="Choose how Seeker opens for you." icon="settings" />
    <section className="panel settings-panel">
      <div className="panel-heading"><h2>Startup page</h2></div>
      <div className="panel-body settings-body">
        <label className="field" htmlFor="startup-page">Open this page when I open Seeker
          <select id="startup-page" value={startPage} disabled={loading || saving} onChange={event => setStartPage(event.target.value as StartPage)}>
            {startPages.map(page => <option key={page.path} value={page.path}>{page.label}</option>)}
          </select>
        </label>
        <p className="muted">The default startup page is Avilys.</p>
        <button className="primary-button" type="button" disabled={loading || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save settings'}</button>
        <Feedback message={message} error={error} />
      </div>
    </section>
    <ProviderSettings />
    <AgentSettings />
    <section className="panel settings-panel">
      <div className="panel-heading"><h2>Open Dracula events in Seeker</h2></div>
      <div className="panel-body settings-body">
        <p>Create a bookmark named “Open in Seeker” and paste this code into its URL field. Then open a Dracula event and select the bookmark.</p>
        <label className="field">Bookmark URL
          <textarea readOnly rows={4} value={bookmarklet} onFocus={event => event.currentTarget.select()} />
        </label>
        <p className="muted">The event opens in a new tab. Sign in to Seeker if prompted.</p>
      </div>
    </section>
  </>;
}
