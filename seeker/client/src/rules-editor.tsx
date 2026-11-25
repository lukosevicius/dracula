import { useEffect, useRef, useState } from 'react';
import { CrepeBuilder } from '@milkdown/crepe/builder';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { topBar } from '@milkdown/crepe/feature/top-bar';
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/top-bar.css';
import '@milkdown/crepe/theme/frame-dark.css';
import { errorMessage } from './data';
import { Feedback } from './workspace';

export default function RulesEditor({ markdown, onChange, disabled }: { markdown: string; onChange: (value: string) => void; disabled: boolean }) {
  const [mode, setMode] = useState<'visual' | 'source'>('visual');
  const [failure, setFailure] = useState('');
  const surface = useRef<HTMLDivElement>(null);
  const instance = useRef<CrepeBuilder | null>(null);
  const current = useRef({ markdown, onChange, disabled });
  useEffect(() => {
    current.current = { markdown, onChange, disabled };
  }, [markdown, onChange, disabled]);
  useEffect(() => { instance.current?.setReadonly(disabled); }, [disabled]);

  useEffect(() => {
    if (mode !== 'visual' || !surface.current) return;
    let disposed = false;
    const root = document.createElement('div');
    surface.current.appendChild(root);
    const editor = new CrepeBuilder({ root, defaultValue: current.current.markdown })
      .addFeature(cursor)
      .addFeature(listItem)
      .addFeature(linkTooltip)
      .addFeature(placeholder, { text: 'Write event verification rules…' })
      .addFeature(topBar);
    editor.on(listener => listener.markdownUpdated((_context, value) => {
      if (!disposed && instance.current === editor) current.current.onChange(value);
    }));
    const opening = editor.create().then(() => {
      if (disposed) return;
      editor.setReadonly(current.current.disabled);
      instance.current = editor;
      root.querySelector('.ProseMirror')?.setAttribute('aria-label', 'AI rules Markdown');
    }).catch(error => {
      if (!disposed) {
        setFailure(errorMessage(error));
        setMode('source');
      }
    });
    return () => {
      disposed = true;
      instance.current = null;
      root.remove();
      void opening.then(() => editor.destroy()).catch(() => undefined);
    };
  }, [mode]);

  return <div className="stack">
    <div className="inline-actions" role="group" aria-label="Editor mode">
      <button className="secondary-button" type="button" aria-pressed={mode === 'visual'} disabled={disabled} onClick={() => { setFailure(''); setMode('visual'); }}>Visual</button>
      <button className="secondary-button" type="button" aria-pressed={mode === 'source'} disabled={disabled} onClick={() => setMode('source')}>Markdown</button>
    </div>
    {failure && <Feedback message={failure} error />}
    {mode === 'visual'
      ? <div className="ai-rules-crepe" ref={surface} />
      : <textarea aria-label="AI rules Markdown" className="ai-rules-source" value={markdown} disabled={disabled} onChange={event => onChange(event.target.value)} />}
  </div>;
}
