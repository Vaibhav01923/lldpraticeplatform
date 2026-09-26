import { useEffect, useMemo, useState } from 'react';
import type { DesignModelDto } from '../../../shared/contracts';
import { toMermaid } from '../lib/design';

type MermaidApi = (typeof import('mermaid'))['default'];
let loading: Promise<MermaidApi> | null = null;
let counter = 0;

/** Mermaid is large, so it is only fetched once a diagram is actually shown. */
function loadMermaid(): Promise<MermaidApi> {
  loading ??= import('mermaid').then((m) => m.default);
  return loading;
}

/**
 * Draws a parsed design as a class diagram. The text handed to Mermaid is generated from the validated model
 * (identifier-only class names, sanitised members), and Mermaid runs in its strict security mode.
 */
export function DiagramPreview({ model, emptyText = 'Add a class to see your diagram here.' }: { model?: DesignModelDto; emptyText?: string }) {
  const text = useMemo(() => (model && model.classes.length > 0 ? toMermaid(model) : ''), [model]);
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  useEffect(() => {
    let cancelled = false;
    if (!text) {
      setSvg('');
      setFailed(false);
      return;
    }
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', class: { useMaxWidth: true } });
        const { svg: drawn } = await mermaid.render(`lld-diagram-${++counter}`, text);
        if (!cancelled) {
          setSvg(drawn);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!text) return <div className="diagram muted small" style={{ display: 'grid', placeItems: 'center' }}>{emptyText}</div>;
  if (failed) return <div className="diagram muted small">The diagram could not be drawn, but your design is still saved and will be reviewed.</div>;
  return (
    <>
      <div className="diagram-wrap">
        <button className="btn btn-sm diagram-expand" onClick={() => setExpanded(true)} aria-label="Expand the diagram">Expand</button>
        <div className="diagram" aria-label="Class diagram of your design" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      {expanded && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Class diagram">
          <div className="row-between">
            <b>Your design</b>
            <button className="btn btn-sm" onClick={() => setExpanded(false)} autoFocus>Close (Esc)</button>
          </div>
          <div className="overlay-body" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}
    </>
  );
}
