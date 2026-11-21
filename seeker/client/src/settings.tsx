import { useEffect, useState } from 'react';
import { api, errorMessage } from './data';
import { Feedback, PageHeading } from './workspace';

export const startPages = [
  { path: '/avilys.html', label: 'Avilys' },
  { path: '/artists.html', label: 'Artists' },
  { path: '/saved-events.html', label: 'Saved events' },
  { path: '/vilnius-events.html', label: 'Vilnius Events' },
  { path: '/ai-evaluation.html', label: 'AI evaluation' },
] as const;

export type StartPage = typeof startPages[number]['path'];
export const defaultStartPage: StartPage = '/avilys.html';

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
  </>;
}
