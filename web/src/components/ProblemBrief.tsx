import { useState } from 'react';
import type { ProblemDto } from '../../../shared/contracts';
import { markHintsOpened } from '../lib/hints';

/** The problem statement, kept beside the workspace so it is never a tab away while designing. */
export function ProblemBrief({ problem, compact = false, attemptId }: { problem: ProblemDto; compact?: boolean; attemptId?: string }) {
  const [tab, setTab] = useState<'requirements' | 'scope' | 'hints'>('requirements');
  const [showHints, setShowHints] = useState(false);

  return (
    <div className="card">
      <div className="card-body" style={{ paddingBottom: 0 }}>
        <h3>{problem.title}</h3>
        {!compact && <p className="muted small" style={{ marginTop: 6 }}>{problem.context}</p>}
        <div className="tabs" role="tablist" style={{ marginTop: 10 }}>
          {([['requirements', 'Requirements'], ['scope', 'Scope'], ['hints', 'Hints']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body" style={{ paddingTop: 0 }} role="tabpanel">
        {tab === 'requirements' && (
          <ul className="req-list">
            {problem.requirements.map((r) => (
              <li key={r.id}>
                <span className="req-id">{r.id}</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        )}
        {tab === 'scope' && (
          <div className="stack-sm">
            <h4 className="small muted">Constraints</h4>
            <ul className="small stack-sm" style={{ paddingLeft: 18 }}>{problem.constraints.map((c) => <li key={c}>{c}</li>)}</ul>
            <h4 className="small muted" style={{ marginTop: 8 }}>Out of scope</h4>
            <ul className="small stack-sm" style={{ paddingLeft: 18 }}>{problem.outOfScope.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        {tab === 'hints' && (
          <div className="hint-list">
            {!showHints ? (
              <>
                <p className="small muted">Try without hints first. You will learn more from getting stuck a little.</p>
                <button className="btn btn-sm" onClick={() => { setShowHints(true); if (attemptId) markHintsOpened(attemptId); }}>Show hints</button>
              </>
            ) : (
              problem.hints.map((h) => <div key={h} className="hint">{h}</div>)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
