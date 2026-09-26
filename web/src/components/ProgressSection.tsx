import { useNavigate } from 'react-router-dom';
import type { AttemptSummaryDto, ComparisonDto, DimensionId, ProgressDto } from '../../../shared/contracts';
import { STATUS_LABELS, formatDelta, formatWhen } from '../lib/labels';
import { BandPill, Pill } from './ui';

const DIMENSIONS: { id: DimensionId; label: string; color: string }[] = [
  { id: 'requirements', label: 'Requirements', color: '#6366f1' },
  { id: 'responsibilities', label: 'Responsibilities', color: '#10a36a' },
  { id: 'abstractions', label: 'Abstractions', color: '#d98a00' },
  { id: 'extensibility', label: 'Extensibility', color: '#2f80d8' },
  { id: 'communication', label: 'Trade-offs', color: '#c2409b' },
];

function TrendChart({ attempts }: { attempts: AttemptSummaryDto[] }) {
  const scored = attempts.filter((a) => a.overall !== undefined).sort((a, b) => a.number - b.number);
  if (scored.length === 0) return null;
  const W = 560, H = 230, L = 34, R = 16, T = 14, B = 30;
  // Zoom the axis to the data (always ending at 4) so real movement is visible instead of flattened against 0–4.
  const seen = scored.flatMap((a) => [a.overall!, ...Object.values(a.dimensionScores ?? {})]);
  const lo = Math.max(0, Math.min(3, Math.floor(Math.min(...seen)) - 1));
  const ticks = Array.from({ length: 4 - lo + 1 }, (_, i) => lo + i);
  const x = (i: number) => (scored.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (scored.length - 1));
  const y = (v: number) => T + (1 - (v - lo) / (4 - lo)) * (H - T - B);
  const line = (get: (a: AttemptSummaryDto) => number | undefined) =>
    scored.flatMap((a, i) => { const v = get(a); return v === undefined ? [] : [`${x(i)},${y(v)}`]; }).join(' ');

  return (
    <div className="stack-sm">
      <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score trend across ${scored.length} attempts`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray={v === lo ? undefined : '3 4'} />
            <text x={L - 8} y={y(v) + 3} textAnchor="end">{v}</text>
          </g>
        ))}
        {DIMENSIONS.map((d) => (
          <polyline key={d.id} points={line((a) => a.dimensionScores?.[d.id])} fill="none" stroke={d.color} strokeWidth="1.5" opacity="0.55" strokeLinejoin="round" />
        ))}
        <polyline points={line((a) => a.overall)} fill="none" stroke="var(--text)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {scored.map((a, i) => (
          <g key={a.id}>
            <circle cx={x(i)} cy={y(a.overall!)} r="5" fill="var(--surface)" stroke="var(--text)" strokeWidth="2.5" />
            <text x={x(i)} y={H - 10} textAnchor="middle">#{a.number}</text>
            <text x={x(i)} y={y(a.overall!) - 10} textAnchor="middle" style={{ fill: 'var(--text)', fontWeight: 700 }}>{a.overall!.toFixed(1)}</text>
          </g>
        ))}
      </svg>
      <div className="legend">
        <span><i style={{ background: 'var(--text)' }} />Overall</span>
        {DIMENSIONS.map((d) => <span key={d.id}><i style={{ background: d.color }} />{d.label}</span>)}
      </div>
    </div>
  );
}

function DeltaText({ value }: { value: number }) {
  return <span className={`delta ${value > 0 ? 'up' : value < 0 ? 'down' : 'flat'}`}>{formatDelta(value)}</span>;
}

export function ComparisonCard({ c }: { c: ComparisonDto }) {
  const rows = c.dimensionDeltas;
  return (
    <div className="card card-pad stack">
      <div className="row-between">
        <h2>What changed since attempt #{c.fromNumber}</h2>
        <span className="row" style={{ gap: 6 }}>Overall <DeltaText value={c.overallDelta} /></span>
      </div>
      {c.caveat && <p className="help" style={{ margin: 0 }}>{c.caveat}</p>}
      <div className="row" style={{ gap: 18 }}>
        {rows.map((d) => (
          <div key={d.dimension} className="stack-sm" style={{ gap: 2, minWidth: 110 }}>
            <span className="small muted">{DIMENSIONS.find((x) => x.id === d.dimension)?.label}</span>
            <span><b>{d.from.toFixed(1)}</b> → <b>{d.to.toFixed(1)}</b> <DeltaText value={d.delta} /></span>
          </div>
        ))}
      </div>
      <div className="change-cols">
        <div className="change-col"><h4>Fixed ({c.resolved.length})</h4><ul>{c.resolved.length ? c.resolved.map((f) => <li key={f.id}>✓ {f.title}</li>) : <li className="faint">Nothing resolved yet</li>}</ul></div>
        <div className="change-col"><h4>Still open ({c.persisting.length})</h4><ul>{c.persisting.length ? c.persisting.map((f) => <li key={f.id}>○ {f.title}</li>) : <li className="faint">None</li>}</ul></div>
        <div className="change-col"><h4>New ({c.introduced.length})</h4><ul>{c.introduced.length ? c.introduced.map((f) => <li key={f.id}>+ {f.title}</li>) : <li className="faint">None</li>}</ul></div>
      </div>
      <p className="help" style={{ margin: 0 }}>Tracks structural findings, which keep the same identity between attempts. The AI's comments are worded fresh each time, so they are not counted.</p>
    </div>
  );
}

export function AttemptsTable({ attempts, showProblem = false }: { attempts: AttemptSummaryDto[]; showProblem?: boolean }) {
  const navigate = useNavigate();
  if (attempts.length === 0) return <div className="empty">No attempts yet.</div>;
  return (
    <div className="card" style={{ overflow: 'auto' }}>
      <table className="table">
        <thead>
          <tr>{showProblem && <th>Problem</th>}<th>Attempt</th><th>Started</th><th>Status</th><th>Score</th><th>Profile</th></tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr key={a.id} className="clickable" onClick={() => navigate(`/attempts/${a.id}`)}>
              {showProblem && <td>{a.problemTitle}</td>}
              <td><a href={`/attempts/${a.id}`} onClick={(e) => e.preventDefault()}>#{a.number}</a></td>
              <td className="muted small">{formatWhen(a.submittedAt ?? a.createdAt)}</td>
              <td><Pill tone={a.status === 'EVALUATED' ? 'good' : a.status === 'DRAFT' ? 'muted' : a.status === 'EVALUATION_FAILED' ? 'bad' : a.status === 'PARTIALLY_EVALUATED' ? 'warn' : 'info'}>{STATUS_LABELS[a.status]}</Pill></td>
              <td>{a.overall !== undefined ? <span className="row" style={{ gap: 8 }}><b className="score-mini">{a.overall.toFixed(1)}</b><BandPill band={a.band} /></span> : <span className="faint">—</span>}</td>
              <td>
                {a.dimensionScores ? (
                  <div className="minibars" aria-label="Score profile across the five dimensions">
                    {DIMENSIONS.map((d) => <i key={d.id} title={`${d.label}: ${a.dimensionScores?.[d.id]?.toFixed(1)}`} style={{ height: `${((a.dimensionScores?.[d.id] ?? 0) / 4) * 100}%`, background: d.color }} />)}
                  </div>
                ) : <span className="faint">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProgressSection({ progress }: { progress: ProgressDto }) {
  const withScores = progress.attempts.filter((a) => a.overall !== undefined);
  return (
    <section className="stack" aria-labelledby="prog-h">
      <h2 id="prog-h">Your progress</h2>
      {withScores.length > 0 && <div className="card card-pad"><TrendChart attempts={progress.attempts} /></div>}
      {progress.comparison && <ComparisonCard c={progress.comparison} />}
      <AttemptsTable attempts={[...progress.attempts].sort((a, b) => b.number - a.number)} />
    </section>
  );
}
