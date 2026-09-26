import { useMemo, useState } from 'react';
import type { EvaluationReportDto, EvidenceDto, FindingDto, Severity } from '../../../../shared/contracts';
import { CONFIDENCE_LABELS, SEVERITY_LABELS } from '../../lib/labels';
import { Pill } from '../ui';

export const anchorId = (id: string) => `f-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

const TONE: Record<Severity, 'bad' | 'warn' | 'info' | 'good'> = { critical: 'bad', major: 'warn', minor: 'info', strength: 'good' };
const CONF_DOTS = { high: 3, medium: 2, low: 1 } as const;

function Evidence({ e }: { e: EvidenceDto }) {
  const label = e.kind === 'class' ? e.ref : e.kind === 'requirement' ? e.ref : e.kind === 'scenario' ? e.ref.split(':')[0]! : e.ref;
  return <span className="chip" title={e.note ?? `${e.kind}: ${e.ref}`}>{label}</span>;
}

export function FindingCard({ f }: { f: FindingDto }) {
  const dots = CONF_DOTS[f.confidence];
  return (
    <article className={`finding ${f.severity}`} id={anchorId(f.id)}>
      <div className="row" style={{ marginBottom: 6 }}>
        <Pill tone={TONE[f.severity]}>{SEVERITY_LABELS[f.severity]}</Pill>
        <span className="finding-title grow">{f.title}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>{f.detail}</p>
      {f.suggestion && <div className="try"><b>Try: </b>{f.suggestion}</div>}
      {f.disputedReason && (
        <div className="disputed"><b>The AI reviewer disagrees: </b>{f.disputedReason} Weigh this one against your own judgement.</div>
      )}
      <div className="meta">
        {f.evidence.filter((e) => e.kind !== 'scenario' || true).slice(0, 8).map((e, i) => <Evidence key={i} e={e} />)}
        <span className="grow" />
        <Pill tone={f.source === 'ai' ? 'accent' : 'muted'} title={f.source === 'ai' ? 'Written by the AI reviewer' : 'Found by a deterministic structural check'}>{f.source === 'ai' ? 'AI review' : 'Structural check'}</Pill>
        <span className="conf" title={CONFIDENCE_LABELS[f.confidence]} aria-label={CONFIDENCE_LABELS[f.confidence]}>
          {[1, 2, 3].map((n) => <i key={n} className={n <= dots ? 'on' : ''} />)}
        </span>
      </div>
    </article>
  );
}

type Filter = 'all' | 'issues' | 'strengths';

export function Findings({ report }: { report: EvaluationReportDto }) {
  const [filter, setFilter] = useState<Filter>('issues');
  const issues = report.findings.filter((f) => f.severity !== 'strength');
  const strengths = report.findings.filter((f) => f.severity === 'strength');
  const shown = filter === 'all' ? report.findings : filter === 'issues' ? issues : strengths;

  const groups = useMemo(
    () => report.dimensions.map((d) => ({ d, items: shown.filter((f) => f.dimension === d.dimension) })).filter((g) => g.items.length > 0),
    [report.dimensions, shown],
  );

  return (
    <section className="stack" aria-labelledby="findings-h">
      <div className="row-between">
        <h2 id="findings-h">Feedback in detail</h2>
        <div className="filters" role="group" aria-label="Filter feedback">
          {([['issues', `To improve (${issues.length})`], ['strengths', `Going well (${strengths.length})`], ['all', 'All']] as const).map(([id, label]) => (
            <button key={id} className={`filter ${filter === id ? 'active' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </div>
      {groups.length === 0 && <div className="empty card">{filter === 'issues' ? 'No issues found. Nice work.' : 'Nothing to show here.'}</div>}
      {groups.map(({ d, items }) => (
        <div key={d.dimension} className="stack-sm">
          <h3 className="muted" style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{d.label}</h3>
          {items.map((f) => <FindingCard key={f.id} f={f} />)}
        </div>
      ))}
    </section>
  );
}
