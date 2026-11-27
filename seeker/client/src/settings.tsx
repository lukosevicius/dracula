import { AgentSettings, ProviderSettings } from './workflow-settings';
import { useEffect, useState } from 'react';
import { api, errorMessage, seekerSettingsPath, type SeekerSettingsResponse } from './data';
import { Feedback, PageHeading } from './workspace';

export const startPages = [
  { path: '/avilys.html', label: 'Avilys' },
  { path: '/all-events.html', label: 'All events' },
  { path: '/needs-attention.html', label: 'Needs attention' },
  { path: '/not-music.html', label: 'Other events' },
  { path: '/possible-duplicates.html', label: 'Possible duplicates' },
  { path: '/artists.html', label: 'Artists' },
  { path: '/saved-events.html', label: 'Saved' },
  { path: '/vilnius-events.html', label: 'Vilnius Events' },
  { path: '/ai-evaluation.html', label: 'AI evaluation' },
] as const;

export type StartPage = typeof startPages[number]['path'];
export const defaultStartPage: StartPage = '/avilys.html';

const bookmarklet = "javascript:(()=>{const m=/^(www\\.)?dracula\\.lt$/.test(location.hostname)&&location.pathname.match(/^\\/events\\/([1-9]\\d{0,11})\\/?$/);if(m)window.open('https://seeker.dracula.lt/event.html?id='+m[1],'_blank','noopener');else alert('Open an event on dracula.lt first.');})()";

export function validStartPage(value: unknown): value is StartPage {
  return startPages.some(page => page.path === value);
}

function ImportDefaults({ checked, loading, loadFailed, onChange }: { checked: boolean; loading: boolean; loadFailed: boolean; onChange: (value: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  async function save() {
    setSaving(true);
    setMessage('');
    setError(false);
    try {
      await api(seekerSettingsPath, { key: 'verify_after_import', value: checked });
      setMessage('Import default saved.');
    } catch (cause) {
      setError(true);
      setMessage(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel settings-panel">
    <div className="panel-heading"><h2>Event imports</h2></div>
    <div className="panel-body settings-body">
      <label className="checkbox-label">
        <input type="checkbox" checked={checked} disabled={loading || saving} onChange={event => {
          onChange(event.target.checked);
          setMessage('');
        }} /> Verify with AI after import by default
      </label>
      <p className="muted">Sets the initial checkbox on the Avilys and Vilnius Events import pages.</p>
      <button className="primary-button" type="button" disabled={loading || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save import default'}</button>
      <Feedback message={message || (loadFailed ? 'Could not load the saved import default. Choose a value and save it.' : '')} error={message ? error : loadFailed} />
    </div>
  </section>;
}

export default function SettingsPage() {
  const [startPage, setStartPage] = useState<StartPage>(defaultStartPage);
  const [verifyAfterImport, setVerifyAfterImport] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void api<SeekerSettingsResponse>(seekerSettingsPath)
      .then(({ settings }) => {
        if (!active) return;
        if (validStartPage(settings.start_page)) setStartPage(settings.start_page);
        setVerifyAfterImport(settings.verify_after_import !== false);
      })
      .catch(cause => {
        if (active) setLoadError(errorMessage(cause));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save() {
    setSaving(true);
    setError(false);
    setMessage('');
    try {
      await api(seekerSettingsPath, { key: 'start_page', value: startPage });
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
        <Feedback message={message || loadError} error={message ? error : Boolean(loadError)} />
      </div>
    </section>
    <ImportDefaults checked={verifyAfterImport} loading={loading} loadFailed={Boolean(loadError)} onChange={setVerifyAfterImport} />
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
