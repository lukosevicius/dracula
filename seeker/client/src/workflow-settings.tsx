import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from './data';
import { type Profile, type ProfilesResponse } from './verification';
import { Feedback } from './workspace';

const workflow = '/api/workflow';
const providerLabels = { gemini: 'Google Gemini', openai: 'OpenAI' };
const empty = { name: '', provider: 'gemini' as Profile['provider'], model: '', key: '' };
type ProfileForm = typeof empty & { id?: number };

export function ProviderSettings() {
  const [data, setData] = useState<ProfilesResponse | null>(null);
  const [draft, setDraft] = useState<ProfileForm>(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  async function load() { setData(await api<ProfilesResponse>(workflow + '/providers')); }
  useEffect(() => { void load().catch(cause => { setError(true); setMessage(errorMessage(cause)); }); }, []);

  async function change(value: Record<string, unknown>, feedback: string) {
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      await api(workflow + '/providers', value);
      if (value.action === 'save' || value.action === 'delete' && value.id === draft.id) setDraft(empty);
      await load();
      setMessage(feedback);
    } catch (cause) { setError(true); setMessage(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const { key, ...values } = draft;
    void change({ action: 'save', ...values, ...(key ? { key } : {}) }, 'AI provider saved.');
  }

  return <section className="panel settings-panel">
    <div className="panel-heading"><h2>AI providers</h2></div>
    <div className="panel-body settings-body">
      {data && !data.configured && <p className="muted">Set the AI encryption key on the API server to save provider keys.</p>}
      <p className="muted">Automatic verification uses the default model. Each connection can use a different model or API key.</p>
      {!!data?.profiles.length && <ul className="workflow-settings-list">
        {data.profiles.map(profile => <li key={profile.id}>
          <div><strong>{profile.name}</strong><p>{providerLabels[profile.provider]} · {profile.model}{profile.id === data.default_id ? ' · Default' : ''}</p></div>
          <div className="publication-controls">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft({ ...profile, key: '' })}>Edit</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void change({ action: 'test', id: profile.id }, 'Connection and model tested successfully.')}>Test</button>
            {profile.id !== data.default_id && <button type="button" className="secondary-button" disabled={busy} onClick={() => void change({ action: 'default', id: profile.id }, 'Default model saved.')}>Make default</button>}
            <button type="button" className="text-button" disabled={busy} onClick={() => { if (window.confirm(`Remove ${profile.name}?`)) void change({ action: 'delete', id: profile.id }, 'Provider removed.'); }}>Remove</button>
          </div>
        </li>)}
      </ul>}
      <form className="stack" onSubmit={save}>
        <h3>{draft.id ? 'Edit AI provider' : 'Add AI provider'}</h3>
        <div className="field-grid">
          <label className="field">Connection name <input required maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="field">Provider <select value={draft.provider} onChange={event => setDraft({ ...draft, provider: event.target.value as Profile['provider'], key: '' })}>{Object.entries(providerLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label className="field">Model ID <input required maxLength={150} value={draft.model} placeholder="Enter the provider's model ID" onChange={event => setDraft({ ...draft, model: event.target.value })} /></label>
          <label className="field">API key <input type="password" autoComplete="new-password" placeholder={draft.id ? '••••••••' : undefined} required={!draft.id} value={draft.key} onChange={event => setDraft({ ...draft, key: event.target.value })} /></label>
        </div>
        <div className="publication-controls">
          <button type="submit" className="primary-button" disabled={busy || !data?.configured}>{draft.id ? 'Save provider' : 'Add provider'}</button>
          {draft.id && <button className="text-button" type="button" onClick={() => setDraft(empty)}>Cancel edit</button>}
        </div>
      </form>
      <Feedback message={message} error={error} />
    </div>
  </section>;
}

const scopes: Record<string, string> = {
  'events:read': 'Read events and history',
  'imports:run': 'Start imports',
  'verification:run': 'Run AI verification',
  'findings:propose': 'Propose edits',
  'findings:resolve': 'Approve and dismiss findings',
  'publication:write': 'Publish and unpublish',
};
type Agent = { id: number; name: string; scopes: string[]; revoked_at: string | null };
export function AgentSettings() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(['events:read']);
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function load() { setAgents((await api<{ agents: Agent[] }>(workflow + '/agents')).agents); }
  useEffect(() => { void load().catch(cause => { setError(true); setMessage(errorMessage(cause)); }); }, []);

  async function change(value: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    setError(false);
    try {
      const result = await api<{ token?: string }>(workflow + '/agents', value);
      if (result.token) {
        setToken(result.token); setName(''); setSelected(['events:read']);
      }
      await load();
      setMessage(result.token ? 'Agent credential created.' : 'Agent credential revoked.');
    } catch (cause) { setError(true); setMessage(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <section className="panel settings-panel">
    <div className="panel-heading"><h2>Agent access</h2></div>
    <div className="panel-body settings-body">
      {!!agents.length && <ul className="workflow-settings-list">{agents.map(agent => <li key={agent.id}>
        <div><strong>{agent.name}{agent.revoked_at ? ' · Revoked' : ''}</strong><p>{agent.scopes.map(scope => scopes[scope]).join(' · ')}</p></div>
        {!agent.revoked_at && <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (window.confirm(`Revoke access for ${agent.name}?`)) void change({ action: 'revoke', id: agent.id }); }}>Revoke</button>}
      </li>)}</ul>}
      <form className="stack" onSubmit={event => { event.preventDefault(); void change({ action: 'create', name, scopes: selected }); }}>
        <label className="field">Agent name <input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
        <fieldset className="agent-permissions">
          <legend>Permissions</legend>
          {Object.entries(scopes).map(([key, label]) => <label key={key} className="checkbox-label">
            <input type="checkbox" checked={selected.includes(key)} onChange={event => setSelected(current => event.target.checked ? [...current, key] : current.filter(scope => scope !== key))} />{label}
          </label>)}
        </fieldset>
        <button type="submit" className="primary-button" disabled={busy || !selected.length}>Create agent credential</button>
      </form>
      {token && <label className="field">Copy this credential. Seeker shows it once.
        <input readOnly value={token} onFocus={event => event.currentTarget.select()} />
      </label>}
      <Feedback message={message} error={error} />
    </div>
  </section>;
}
