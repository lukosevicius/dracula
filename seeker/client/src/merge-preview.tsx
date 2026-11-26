import { useState } from 'react';
import { api, errorMessage } from './data';
import { Feedback } from './workspace';

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

  async function merge() {
    setSaving(true);
    setError('');
    try {
      const chosen = Object.fromEntries(preview.fields.filter(field => field.kept !== field.other).map(field => [field.field, choices[field.field]]));
      const result = await api<{ event_id: number; merged_event_id: number }>(`${workflow}/merge`, { event_ids: eventIds, choices: chosen });
      onMerged(`Merged #${result.merged_event_id} into #${result.event_id}.`);
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  }

  const { kept, removed } = preview;
  const source = (side: Side) => `#${side.id}${side.sources.length ? ` · ${side.sources.join(', ')}` : ''}`;
  const open = preview.fields.filter(field => field.conflict && choices[field.field] === kept.id && field.kept !== field.other).length;
  return <div className="merge-preview" aria-label="Merge preview">
    <p className="merge-preview-summary">
      Keeps <strong>#{kept.id}</strong> ({kept.publication_status === 'live' ? 'Live' : 'Draft'}) with listings from {[...kept.sources, ...removed.sources].join(' and ')}.
      {' '}#{removed.id} is removed and its link redirects to #{kept.id}.
    </p>
    <div className="merge-preview-fields" role="table">
      {preview.fields.map(field => {
        const same = field.kept === field.other;
        return <div className="merge-preview-row" role="row" key={field.field}>
          <span className="merge-preview-label" role="rowheader">{field.label}{field.conflict && <span className="merge-preview-flag">Differs</span>}</span>
          <span role="cell" className="merge-preview-values">
            {same ? <span className="merge-preview-same">{display(field.kept)}</span>
              : [[kept, field.kept], [removed, field.other]].map(([side, value]) => {
                const id = (side as Side).id, selected = choices[field.field] === id;
                return <button key={id} type="button" className={`merge-option${selected ? ' selected' : ''}`} aria-pressed={selected} disabled={saving}
                  onClick={() => setChoices(current => ({ ...current, [field.field]: id }))}>
                  <span className="merge-option-value">{display(value as string | null)}</span>
                  <span className="merge-option-source">{source(side as Side)}</span>
                </button>;
              })}
          </span>
        </div>;
      })}
    </div>
    <Feedback message={error} error />
    <div className="merge-preview-actions">
      <button className="primary-button" type="button" disabled={saving} onClick={() => void merge()}>{saving ? 'Merging…' : 'Merge'}</button>
      {open > 0 && <span className="duplicate-note">{open === 1 ? '1 differing value keeps' : `${open} differing values keep`} #{kept.id}'s value. Switch it above if needed.</span>}
    </div>
  </div>;
}
