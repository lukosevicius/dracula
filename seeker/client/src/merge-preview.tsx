import { useState } from 'react';
import { api, errorMessage } from './data';
import { Feedback, Icon } from './workspace';

export type Field = { field: string; label: string; kept: string | null; other: string | null; choice: number; conflict: boolean };
type Side = { id: number; publication_status: string; sources: string[] };
export type Preview = { kept: Side; removed: Side; fields: Field[]; conflicts: boolean };
const workflow = '/api/workflow/duplicates';
const display = (value: string | null) => value ?? '—';

/** The merged event field by field. Differing values can be switched before merging; the merge saves exactly this. */
export function MergePreview({ preview, eventIds, onMerged }: { preview: Preview; eventIds: [number, number]; onMerged: (message: string) => void }) {
  const [choices, setChoices] = useState<Record<string, number>>(() => Object.fromEntries(preview.fields.map(field => [field.field, field.choice])));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Your own title for the merged event; null while one of the listed titles is used.
  const [ownTitle, setOwnTitle] = useState<string | null>(null);

  async function merge() {
    setSaving(true);
    setError('');
    try {
      const chosen = Object.fromEntries(preview.fields.filter(field => field.kept !== field.other).map(field => [field.field, choices[field.field]]));
      const result = await api<{ event_id: number; merged_event_id: number }>(`${workflow}/merge`, { event_ids: eventIds, choices: chosen, own_title: ownTitle?.trim() || undefined });
      onMerged(`Merged #${result.merged_event_id} into #${result.event_id}.`);
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  }

  const { kept, removed } = preview;
  const source = (side: Side) => `#${side.id}${side.sources.length ? ` · ${side.sources.join(', ')}` : ''}`;
  const open = preview.fields.filter(field => field.conflict && choices[field.field] === kept.id && field.kept !== field.other).length;
  // Ticket links get a button to open them in a new tab. Only web links are opened.
  const openLink = (field: string, value: string | null) => field === 'ticket_url' && value && /^https?:\/\//i.test(value)
    ? <a className="icon-button merge-option-open" href={value} target="_blank" rel="noreferrer" aria-label={`Open ${value}`} title="Open link"><Icon name="external" size={15} /></a> : null;
  return <div className="merge-preview" aria-label="Merge preview">
    <p className="merge-preview-summary">
      Keeps <strong>#{kept.id}</strong> ({kept.publication_status === 'live' ? 'Live' : 'Draft'}) with listings from {[...kept.sources, ...removed.sources].join(' and ')}.
      {' '}#{removed.id} is removed and its link redirects to #{kept.id}.
    </p>
    <div className="merge-preview-fields" role="table">
      {preview.fields.map(field => {
        const same = field.kept === field.other;
        if (field.field === 'title') return <div className="merge-preview-row" role="row" key={field.field}>
          <span className="merge-preview-label" role="rowheader">{field.label}{field.conflict && <span className="merge-preview-flag">Differs</span>}</span>
          <span role="cell" className="merge-preview-values">
            {(same ? [[kept, field.kept]] : [[kept, field.kept], [removed, field.other]]).map(([side, value]) => {
              const id = (side as Side).id, selected = ownTitle === null && (same || choices.title === id);
              return <button key={id} type="button" className={`merge-option${selected ? ' selected' : ''}`} aria-pressed={selected} disabled={saving}
                onClick={() => { setOwnTitle(null); setChoices(current => ({ ...current, title: id })); }}>
                <span className="merge-option-value">{display(value as string | null)}</span>
                <span className="merge-option-source">{same ? 'Both events' : source(side as Side)}</span>
              </button>;
            })}
            {ownTitle === null
              ? <button type="button" className="merge-option" disabled={saving}
                onClick={() => setOwnTitle((choices.title === removed.id ? field.other : field.kept) ?? '')}>
                <span className="merge-option-value">Own title…</span><span className="merge-option-source">Write your own</span>
              </button>
              : <span className="merge-option selected merge-own-title">
                <input aria-label="Own title" value={ownTitle} autoFocus disabled={saving} maxLength={300} onChange={event => setOwnTitle(event.target.value)} />
                <span className="merge-option-source">Your title · kept by later imports</span>
              </span>}
          </span>
        </div>;
        return <div className="merge-preview-row" role="row" key={field.field}>
          <span className="merge-preview-label" role="rowheader">{field.label}{field.conflict && <span className="merge-preview-flag">Differs</span>}</span>
          <span role="cell" className="merge-preview-values">
            {same ? <span className="merge-option-wrap"><span className="merge-preview-same">{display(field.kept)}</span>{openLink(field.field, field.kept)}</span>
              : [[kept, field.kept], [removed, field.other]].map(([side, value]) => {
                const id = (side as Side).id, selected = choices[field.field] === id;
                return <span key={id} className="merge-option-wrap">
                  <button type="button" className={`merge-option${selected ? ' selected' : ''}`} aria-pressed={selected} disabled={saving}
                    onClick={() => setChoices(current => ({ ...current, [field.field]: id }))}>
                    <span className="merge-option-value">{display(value as string | null)}</span>
                    <span className="merge-option-source">{source(side as Side)}</span>
                  </button>
                  {openLink(field.field, value as string | null)}
                </span>;
              })}
          </span>
        </div>;
      })}
    </div>
    <Feedback message={error} error />
    <div className="merge-preview-actions">
      <button className="primary-button" type="button" disabled={saving || (ownTitle !== null && !ownTitle.trim())} onClick={() => void merge()}>{saving ? 'Merging…' : 'Merge'}</button>
      {open > 0 && <span className="duplicate-note">{open === 1 ? '1 differing value keeps' : `${open} differing values keep`} #{kept.id}'s value. Switch it above if needed.</span>}
    </div>
  </div>;
}
