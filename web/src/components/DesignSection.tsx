import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { DesignModelDto, FormatInfoDto, PreflightDto } from '../../../shared/contracts';
import { api } from '../lib/api';
import { hasContent, toCardPayload, toMermaid } from '../lib/design';
import { useDebounced } from '../lib/hooks';
import { DiagramPreview } from './DiagramPreview';
import { editorFor } from './editors';
import { Spinner } from './ui';

interface Props {
  formats: FormatInfoDto[];
  format: string;
  design: unknown;
  onChange: (format: string, design: unknown) => void;
  /** Reports the latest preflight result (undefined while there is nothing to check). */
  onPreflight: (result: PreflightDto | undefined) => void;
}

/** Re-express a parsed design in another format, so switching never throws away the learner's work. */
function convert(model: DesignModelDto, to: FormatInfoDto): unknown {
  if (to.id === 'crc-cards') return toCardPayload(model);
  if (to.id === 'mermaid-class') return { source: toMermaid(model, { responsibilityNotes: true }) };
  return to.starter;
}

export function DesignSection({ formats, format, design, onChange, onPreflight }: Props) {
  const Editor = editorFor(format);
  const debounced = useDebounced(design, 500);
  const worthChecking = hasContent(format, debounced);

  const preflight = useQuery({
    queryKey: ['preflight', format, JSON.stringify(debounced)],
    queryFn: () => api.preflight(format, debounced),
    enabled: worthChecking,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
  const result = worthChecking ? preflight.data : undefined;

  useEffect(() => onPreflight(result), [result, onPreflight]);

  const switchTo = (target: FormatInfoDto) => {
    if (target.id === format) return;
    if (!hasContent(format, design)) return onChange(target.id, target.starter);
    if (result?.ok && result.model) {
      if (window.confirm(`Switch to “${target.label}”? Your design will be converted.`)) onChange(target.id, convert(result.model, target));
    } else if (window.confirm(`Your design has errors, so it cannot be converted. Switch to “${target.label}” and start it fresh?`)) {
      onChange(target.id, target.starter);
    }
  };

  const errors = result?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = result?.issues.filter((i) => i.severity === 'warning') ?? [];
  const stats = result?.stats;

  return (
    <div className="stack">
      {formats.length > 1 && (
        <div className="row" role="group" aria-label="Design format">
          <span className="small muted">Write it as</span>
          <div className="filters">
            {formats.map((f) => (
              <button key={f.id} className={`filter ${f.id === format ? 'active' : ''}`} onClick={() => switchTo(f)} aria-pressed={f.id === format} title={f.description}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="help">{formats.find((f) => f.id === format)?.description}</p>

      <Editor value={design} onChange={(v) => onChange(format, v)} />

      <div className="stack-sm" aria-live="polite">
        <div className="row small">
          {preflight.isFetching && worthChecking && <Spinner />}
          {stats ? (
            <span className="muted">
              {stats.classes} classes · {stats.relationships} relationships · {stats.abstractions} abstractions · {stats.withResponsibility}/{stats.classes} with a stated responsibility
            </span>
          ) : (
            !worthChecking && <span className="muted">Your design is checked as you type.</span>
          )}
        </div>
        {(errors.length > 0 || warnings.length > 0) && (
          <div className="issues">
            {errors.map((i, n) => (
              <div key={`e${n}`} className="issue">
                <span className="pill bad">Fix</span>
                <span>{i.message} {i.location && <span className="loc">({i.location})</span>}</span>
              </div>
            ))}
            {warnings.map((i, n) => (
              <div key={`w${n}`} className="issue">
                <span className="pill warn">Note</span>
                <span>{i.message} {i.location && <span className="loc">({i.location})</span>}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details open>
        <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 10 }}>Live diagram</summary>
        <DiagramPreview model={result?.ok ? result.model : undefined} emptyText={errors.length ? 'Fix the issues above to see your diagram.' : 'Add a class to see your diagram here.'} />
      </details>
    </div>
  );
}
