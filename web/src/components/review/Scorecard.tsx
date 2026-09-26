import { useState } from 'react';
import type { DimensionScoreDto, EvaluationReportDto } from '../../../../shared/contracts';
import { bandTone } from '../../lib/labels';
import { BandPill, Chevron, Pill, ScoreBar } from '../ui';

function Dimension({ d }: { d: DimensionScoreDto }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dim">
      <button className="dim-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Chevron open={open} />
        <span className="dim-name">{d.label}</span>
        <ScoreBar score={d.score} band={d.band} />
        <span className="dim-score">{d.score.toFixed(1)}</span>
      </button>
      {open && (
        <div className="dim-detail">
          <div className="row" style={{ gap: 6 }}>
            <Pill tone={bandTone(d.band)}>{d.band}</Pill>
            <span className="faint">from {d.sources.map((s) => (s === 'rules' ? 'structural checks' : 'AI review')).join(' + ') || 'nothing'}</span>
          </div>
          {d.caps.map((c) => <div key={c} className="pill warn" style={{ borderRadius: 8, whiteSpace: 'normal' }}>{c}</div>)}
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {d.rationale.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Scorecard({ report }: { report: EvaluationReportDto }) {
  return (
    <div className="card card-pad stack">
      <div className="overall">
        <div className="overall-score">{report.overall.toFixed(1)}<small>/4</small></div>
        <div className="stack-sm" style={{ gap: 4 }}>
          <div className="row">
            <BandPill band={report.band} />
            {report.provisional && <Pill tone="info">Provisional</Pill>}
          </div>
          <span className="small muted">Weighted across five dimensions</span>
        </div>
      </div>
      <div>
        {report.dimensions.map((d) => <Dimension key={d.dimension} d={d} />)}
      </div>
      <p className="help" style={{ margin: 0 }}>Scores are a coarse guide, built from named criteria. Open a row to see exactly why. The findings matter more than the number.</p>
    </div>
  );
}
