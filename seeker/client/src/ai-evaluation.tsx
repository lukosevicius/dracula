import { useCallback, useEffect, useState } from 'react';
import type { ReviewStatus } from '../../types';
import { api, errorMessage, formatDate, isActive, labels, plainText, useJobs, type EventPage } from './data';
import { Disclosure, Feedback, Icon, PageHeading, Pagination, PanelHeading } from './workspace';

type Performer = { name: string; evidence: string; evidence_verified: boolean; matches: { mbid: string; name: string }[] };
type Result = {
  id: number; job_id: number; event_id: number; title: string; review_status: ReviewStatus; model: string;
  classification: ReviewStatus | null; explanation: string | null; performers_json: string; artist_decisions_json: string;
  input_tokens: number; output_tokens: number; cost_usd: number; status: string; error_message: string | null; review_decision: string;
};
type Decision = 'accepted' | 'dismissed';

const pageSize = 25;
const modelNames: Record<string, string> = { 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite', 'gemini-4-hydrogen': 'Gemini 4 Hydrogen' };

function parseJson<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) ?? fallback; } catch { return fallback; }
}

function ModelResult({ result, decide, artist }: {
  result: Result; decide: (decision: Decision) => void; artist: (mbid: string, decision: Decision) => void;
}) {
  const performers = parseJson<Performer[]>(result.performers_json, []);
  const decisions = parseJson<{ mbid: string; decision: string }[]>(result.artist_decisions_json, []);
  return (
    <div className="ai-result">
      <h4>{modelNames[result.model] || result.model}</h4>
      {result.status === 'failed' ? <p className="error-text">{result.error_message}</p> : (
        <>
          <strong>{labels[result.classification || 'unsure']}</strong>
          <p>{result.explanation}</p>
          <div className="inline-actions">
            <button className="secondary-button" onClick={() => decide('accepted')}>Accept classification</button>
            <button className="text-button" onClick={() => decide('dismissed')}>Dismiss</button>
            <small>{result.review_decision}</small>
          </div>
          <h4>Performers</h4>
          {!performers.length && <p>None identified.</p>}
          {performers.map((performer, index) => (
            <div className="ai-performer" key={`${performer.name}-${index}`}>
              <strong>{performer.name}</strong>
              <p>“{performer.evidence}” {!performer.evidence_verified && <span className="error-text">· Quote unverified</span>}</p>
              {!performer.matches.length && <p>No matching artist in the catalogue.</p>}
              {performer.matches.map(match => (
                <div className="inline-actions" key={match.mbid}>
                  <span>{match.name} {decisions.find(decision => decision.mbid === match.mbid)?.decision}</span>
                  <button className="secondary-button" onClick={() => artist(match.mbid, 'accepted')}>Accept</button>
                  <button className="text-button" onClick={() => artist(match.mbid, 'dismissed')}>Dismiss</button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      <small>{result.input_tokens.toLocaleString()} input · {result.output_tokens.toLocaleString()} output tokens · ${result.cost_usd.toFixed(5)} USD estimated</small>
    </div>
  );
}

export default function AiEvaluation() {
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<EventPage | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [amount, setAmount] = useState(10);
  const [budget, setBudget] = useState('0.10');
  const [models, setModels] = useState<string[]>(['gemini-3.5-flash-lite']);
  const [results, setResults] = useState<Result[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [eventsError, setEventsError] = useState('');
  const [resultsError, setResultsError] = useState('');
  const [message, setMessage] = useState('');
  const [hasError, setHasError] = useState(false);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    let active = true;
    setEventsError('');
    void api<EventPage>(`/api/events?when=all&page=${page}&limit=${pageSize}`).then(value => {
      if (active) setEvents(value);
    }).catch(error => {
      if (active) setEventsError(errorMessage(error));
    });
    return () => { active = false; };
  }, [page]);

  const loadResults = useCallback(async () => {
    try {
      const value = await api<{ results: Result[]; configured: boolean }>('/api/ai-evaluations');
      setResults(value.results);
      setConfigured(value.configured);
      setResultsError('');
    } catch (error) {
      setResultsError(errorMessage(error));
    }
  }, []);

  const { jobs, start, startingSource } = useJobs(finished => {
    if (finished.some(job => job.source === 'ai-evaluation')) void loadResults();
  });
  const recentJobs = jobs.filter(job => job.source === 'ai-evaluation').slice(0, 4);
  const running = startingSource === 'ai-evaluation' || recentJobs.some(isActive);
  useEffect(() => {
    void loadResults();
    if (!running) return;
    const timer = window.setInterval(() => void loadResults(), 3000);
    return () => window.clearInterval(timer);
  }, [loadResults, running]);

  const updateSelection = (id: number) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);

  async function report(action: () => Promise<void>, success = '') {
    setMessage('');
    setHasError(false);
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setHasError(true);
      setMessage(errorMessage(error));
    }
  }

  async function selectFirst() {
    setSelecting(true);
    try {
      await report(async () => {
        const value = await api<{ ids: number[] }>(`/api/ai-evaluations/events?limit=${amount}`);
        setSelected(value.ids);
      });
    } finally {
      setSelecting(false);
    }
  }

  const groups = new Map<string, Result[]>();
  for (const result of results) {
    const key = `${result.job_id}:${result.event_id}`;
    groups.set(key, [...(groups.get(key) || []), result]);
  }

  return (
    <>
      <PageHeading title="AI evaluation" description="Compare model classifications and artist suggestions on imported events." icon="spark" />
      <div className="ai-layout">
        <section className="panel">
          <PanelHeading title="Choose events" end={<span className="count-label">{selected.length.toLocaleString()} selected</span>} />
          <div className="ai-picker-tools">
            <label className="field">Number of events <input type="number" min="1" max="5000" value={amount || ''} onChange={event => setAmount(Number(event.target.value))} /></label>
            <button className="secondary-button" disabled={selecting || !Number.isInteger(amount) || amount < 1 || amount > 5000} onClick={() => void selectFirst()}>Select first {amount || ''}</button>
            <button className="text-button" disabled={!selected.length || selecting} onClick={() => setSelected([])}>Clear selection</button>
          </div>
          {eventsError && <div className="catalogue-error"><Feedback message={eventsError} error /></div>}
          <div className="ai-event-list" aria-busy={events?.page !== page && !eventsError}>
            {events?.events.map(event => (
              <label key={event.id}>
                <input type="checkbox" checked={selected.includes(event.id)} disabled={selecting} onChange={() => updateSelection(event.id)} />
                <span>{plainText(event.title)}<small>{event.event_date ? formatDate(event.event_date) : 'Date unknown'} · {labels[event.review_status]}</small></span>
              </label>
            ))}
            {!events && !eventsError && <p className="empty-state" role="status">Loading events…</p>}
            {events && !events.events.length && <p className="empty-state">No events to evaluate.</p>}
          </div>
          {events && events.total > pageSize && <Pagination page={page} total={events.total} size={pageSize} onChange={setPage} />}
        </section>

        <section className="panel ai-config">
          <PanelHeading title="Run analysis" icon="spark" />
          <div className="panel-body stack">
            <div className="model-options" role="group" aria-label="Models">
              {Object.entries(modelNames).map(([id, name]) => (
                <label className="checkbox-label" key={id}>
                  <input type="checkbox" checked={models.includes(id)} onChange={() => setModels(current => current.includes(id) ? current.filter(model => model !== id) : [...current, id])} />{name}
                </label>
              ))}
            </div>
            <label className="field">Maximum estimated spend (USD)
              <input type="number" min="0.001" max="1000" step="0.001" value={budget} onChange={event => setBudget(event.target.value)} />
            </label>
            <button className="primary-button" disabled={running || !configured || !selected.length || !models.length || Number(budget) <= 0 || Number(budget) > 1000} onClick={() => void report(() => start('ai-evaluation', 'analyze', { event_ids: selected, models, budget: Number(budget) }))}>
              <Icon name="spark" /> {running ? 'Analyzing…' : 'Analyze selected events'}
            </button>
            <p>Seeker checks token usage and reserves the maximum output cost before each request. Google receives the event text. The spend limit uses estimated costs.</p>
            {configured === false && <Feedback message="Add GEMINI_API_KEY to seeker/.env and restart Seeker." error />}
            <Feedback message={message} error={hasError} />
          </div>
          <Disclosure title="Recent runs">
            <div className="job-activity">
              {!recentJobs.length && <p>No analysis runs recorded.</p>}
              {recentJobs.map(job => {
                const progress = parseJson<Record<string, number>>(job.progress_json, {});
                return (
                  <div className="activity-item" key={job.id}>
                    <div><strong>Run #{job.id}</strong><span className={`job-status status-${job.status}`}>{job.status}</span></div>
                    <small>{progress.completed || 0}/{progress.total || '—'} requests · ${Number(progress.cost_usd || 0).toFixed(4)} USD estimated</small>
                    {job.error_message && <small className="error-text">{job.error_message}</small>}
                  </div>
                );
              })}
            </div>
          </Disclosure>
        </section>
      </div>

      <section className="ai-results">
        <h2>Review results</h2>
        <p>Accept classifications to update event review status. Review the suggested artists below each classification.</p>
        <Feedback message={resultsError} error />
        {configured !== null && !results.length && <div className="panel"><p className="empty-state">Analysis results will appear here.</p></div>}
        {results.length >= 1000 && <p>Showing the latest 1,000 model results.</p>}
        {[...groups.entries()].map(([key, group]) => (
          <article className="panel" key={key}>
            <PanelHeading title={plainText(group[0].title)} description={`Run #${group[0].job_id} · Current review: ${labels[group[0].review_status]}`} />
            <div className="panel-body ai-result-grid">{group.map(result => (
              <ModelResult key={result.id} result={result}
                decide={decision => void report(async () => {
                  if (decision === 'accepted' && result.classification) {
                    await api(`/api/events/${result.event_id}/review`, { review_status: result.classification });
                  }
                  await api('/api/ai-evaluations/decision', { id: result.id, decision });
                  await loadResults();
                }, `Classification ${decision}.`)}
                artist={(mbid, decision) => void report(async () => {
                  await api(`/api/events/${result.event_id}/artist`, { mbid, decision });
                  await loadResults();
                }, `Artist ${decision}.`)} />
            ))}</div>
          </article>
        ))}
      </section>
    </>
  );
}
