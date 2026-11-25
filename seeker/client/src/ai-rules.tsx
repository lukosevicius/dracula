import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate, plainText, type EventPage, type EventRow } from './data';
import RulesEditor from './rules-editor';
import { OutcomeList, type Outcome, type ProfilesResponse } from './verification';
import { Disclosure, Feedback, PageHeading, PanelHeading } from './workspace';
import './ai-rules.css';

const rulesPath = '/api/workflow/verification/rules';
const options = { auto: 'Apply automatically', review: 'Require review', disabled: 'Disabled' } as const;
type Permission = keyof typeof options;
type Rules = { markdown: string; permissions: Record<string, Permission> };
type RulesState = {
  revision: number; active: Rules & { id: number }; draft: Rules | null;
  versions: { id: number; activated_by: string; activated_at: string | null }[];
  actions: { key: string; label: string }[];
};
type Preview = {
  event_id: number; status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  model: string; rules_version_id: number; draft_revision: number | null; error_message: string | null;
  result: { actions: Outcome[] } | null;
};

function RulesPreview({ rules, dirty, saving }: { rules: RulesState; dirty: boolean; saving: boolean }) {
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [chosen, setChosen] = useState<EventRow | null>(null);
  const [profiles, setProfiles] = useState<ProfilesResponse | null>(null);
  const [model, setModel] = useState('');
  const [loadError, setLoadError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [starting, setStarting] = useState(false);
  const [searching, setSearching] = useState(true);
  const [jobId, setJobId] = useState<number | null>(null);
  const [result, setResult] = useState<Preview | null>(null);
  const attempt = useRef<{ options: string; key: string } | null>(null);

  useEffect(() => {
    let current = true;
    void api<ProfilesResponse>('/api/workflow/providers')
      .then(data => { if (current) setProfiles(data); })
      .catch(error => { if (current) setLoadError(errorMessage(error)); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    setSearching(true);
    setSearchError('');
    const params = new URLSearchParams({ when: search.trim() ? 'all' : 'upcoming', limit: '20', search: search.trim() });
    const timer = window.setTimeout(() => {
      void api<EventPage>('/api/events?' + params).then(data => {
        if (current) setEvents(data.events);
      }).catch(error => {
        if (current) { setEvents([]); setSearchError(errorMessage(error)); }
      }).finally(() => { if (current) setSearching(false); });
    }, search ? 250 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [search]);

  useEffect(() => {
    if (jobId === null) return;
    let current = true;
    let timer: number;
    async function poll() {
      try {
        const data = await api<Preview>(rulesPath + '/previews/' + jobId);
        if (!current) return;
        setResult(data);
        setPreviewError('');
        if (data.status !== 'queued' && data.status !== 'running') return;
      } catch (error) {
        if (!current) return;
        setPreviewError(errorMessage(error));
      }
      timer = window.setTimeout(poll, 1800);
    }
    void poll();
    return () => { current = false; window.clearTimeout(timer); };
  }, [jobId]);

  async function run() {
    if (!chosen) return;
    setStarting(true);
    setPreviewError('');
    const payload = { event_id: chosen.id, revision: rules.revision, ...(model ? { profile_id: Number(model) } : {}) };
    const signature = JSON.stringify(payload);
    if (attempt.current?.options !== signature) attempt.current = { options: signature, key: crypto.randomUUID() };
    try {
      const job = await api<{ id: number }>(rulesPath + '/previews', { ...payload, request_key: attempt.current.key });
      setResult(null);
      setJobId(job.id);
      attempt.current = null;
    } catch (error) {
      setPreviewError(errorMessage(error));
    } finally { setStarting(false); }
  }

  const pending = jobId !== null && (!result || result.status === 'queued' || result.status === 'running');
  const busy = starting || pending;
  const modelReady = profiles?.configured && (model || profiles.default_id);
  const choices = chosen && !events.some(event => event.id === chosen.id) ? [chosen, ...events] : events;
  return <section className="panel">
    <PanelHeading title="Preview on an event" description="Test the saved rules on an existing event. A preview uses your AI provider and leaves the event unchanged." />
    <div className="panel-body stack">
      <label className="field">Search events<input type="search" placeholder="Event or artist name" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} /></label>
      <label className="field">Event
        <select value={chosen?.id ?? ''} disabled={busy || searching} onChange={event => setChosen(choices.find(item => item.id === Number(event.target.value)) ?? null)}>
          <option value="">{searching ? 'Searching…' : choices.length ? 'Select an event' : 'No events found'}</option>
          {choices.map(event => <option key={event.id} value={event.id}>{plainText(event.title)} · {event.event_date ? formatDate(event.event_date) : 'Date unknown'} · #{event.id}</option>)}
        </select>
      </label>
      {!!profiles?.profiles.length && <label className="field">AI model
        <select value={model} disabled={busy} onChange={event => setModel(event.target.value)}>
          <option value="">Default model</option>
          {profiles.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
        </select>
      </label>}
      {profiles && (!profiles.configured || !profiles.profiles.length) && <p className="muted">Add an AI provider in <a className="rules-link" href="/settings.html">Settings</a> to preview your rules.</p>}
      <div className="inline-actions">
        <button className="primary-button" type="button" disabled={dirty || saving || busy || !chosen || !modelReady} onClick={() => void run()}>
          {starting ? 'Starting…' : 'Run preview'}
        </button>
        {dirty && <span className="muted">Save your changes to preview them.</span>}
      </div>
      {pending && <Feedback message={result?.status === 'running' ? 'Evaluating preview…' : 'Preview queued.'} />}
      <Feedback message={loadError || searchError || previewError || result?.error_message || ''} error />
      {result?.status === 'completed' && <div className="stack rules-preview-result">
        <h3>Preview result</h3>
        <p><a className="rules-link" href={`/event.html?id=${result.event_id}`}>Event #{result.event_id}</a> · {result.model} · {result.draft_revision === null ? `Rules v${result.rules_version_id}` : `Draft revision ${result.draft_revision}`}</p>
        <OutcomeList actions={result.result?.actions ?? []} preview />
      </div>}
    </div>
  </section>;
}

export default function AiRules() {
  const [state, setState] = useState<RulesState | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [permissions, setPermissions] = useState<Rules['permissions']>({});
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');

  function show(data: RulesState) {
    setState(data);
    setMarkdown((data.draft ?? data.active).markdown);
    setPermissions((data.draft ?? data.active).permissions);
    setEditorKey(key => key + 1);
  }
  useEffect(() => {
    let current = true;
    void api<RulesState>(rulesPath).then(data => { if (current) show(data); })
      .catch(error => { if (current) setFailure(errorMessage(error)); });
    return () => { current = false; };
  }, []);

  const original = state?.draft ?? state?.active;
  const dirty = Boolean(original && (markdown !== original.markdown ||
    state?.actions.some(({ key }) => permissions[key] !== original.permissions[key])));
  const tooLong = new TextEncoder().encode(markdown).length > 12_000;
  async function update(action: 'save' | 'activate' | 'restore' | 'discard', version?: number) {
    if (!state) return;
    setBusy(true);
    setFailure('');
    setMessage('');
    const options = action === 'save' ? { markdown, permissions } : action === 'restore' ? { version_id: version } : {};
    try {
      const data = await api<RulesState>(rulesPath, { action, revision: state.revision, ...options });
      show(data);
      setMessage(action === 'activate' ? `Rules v${data.active.id} are active.` :
        action === 'discard' ? 'Draft discarded.' : action === 'restore' ? `Rules v${version} loaded as a draft.` : 'Draft saved.');
    } catch (error) { setFailure(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return <div className="main-stack">
    <PageHeading title="AI rules" description="Define how Seeker evaluates events and which changes it can apply." icon="spark" />
    {!state ? failure ? <Feedback message={failure} error /> : <p className="empty-state" role="status">Loading AI rules…</p> : <>
      <section className="panel">
        <PanelHeading title="Verification rules" end={<span className="count-label">Active · v{state.active.id}</span>} />
        <div className="panel-body stack">
          <div className="rules-editor-heading"><strong>{state.draft ? `Draft revision ${state.revision}` : `Rules v${state.active.id}`}</strong>{dirty && <span className="muted">Unsaved changes</span>}</div>
          <RulesEditor key={editorKey} markdown={markdown} onChange={setMarkdown} disabled={busy} />
        </div>
      </section>
      <section className="panel">
        <PanelHeading title="Action permissions" description="Automatic changes require clear evidence and respect manual decisions. Conflicting values require review." />
        <div className="panel-body rules-permissions">
          {state.actions.map(({ key, label }) => <label key={key} className="rules-permission">
            <span>{label}</span>
            <select value={permissions[key]} disabled={busy} onChange={event => setPermissions(values => ({ ...values, [key]: event.target.value as Permission }))}>
              {Object.entries(options).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </label>)}
        </div>
        <div className="panel-body stack rules-save">
          <div className="inline-actions">
            <button type="button" className="secondary-button" disabled={busy || !dirty || tooLong} onClick={() => void update('save')}>Save draft</button>
            <button type="button" className="primary-button" disabled={busy || dirty || !state.draft} onClick={() => void update('activate')}>Activate draft</button>
            {dirty && <button type="button" className="text-button" disabled={busy} onClick={() => show(state)}>Reset edits</button>}
            {!dirty && state.draft && <button type="button" className="text-button" disabled={busy} onClick={() => void update('discard')}>Discard draft</button>}
          </div>
          <Feedback message={failure || (tooLong ? 'Rules can be up to 12 KB.' : message)} error={Boolean(failure || tooLong)} />
        </div>
      </section>
      <RulesPreview rules={state} dirty={dirty} saving={busy} />
      <section className="panel">
        <PanelHeading title="Version history" />
        <div className="panel-body">
          <Disclosure title={`View ${state.versions.length} ${state.versions.length === 1 ? 'version' : 'versions'}`}>
            <ul className="rules-versions">
              {state.versions.map(version => <li key={version.id}>
                <div><strong>Version {version.id}{version.id === state.active.id ? ' · Active' : ''}</strong><p className="muted">{version.activated_by}{version.activated_at ? ` · ${formatDate(version.activated_at, true)}` : ''}</p></div>
                {version.id !== state.active.id && <button className="secondary-button" type="button" disabled={dirty || busy} onClick={() => void update('restore', version.id)}>Restore as draft</button>}
              </li>)}
            </ul>
          </Disclosure>
        </div>
      </section>
    </>}
  </div>;
}
