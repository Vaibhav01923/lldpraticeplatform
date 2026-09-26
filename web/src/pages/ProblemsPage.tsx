import { Link } from 'react-router-dom';
import { DIFFICULTY_LABELS, bandTone } from '../lib/labels';
import { useProblems } from '../lib/queries';
import { ErrorNotice, Loading, Pill } from '../components/ui';

const STEPS = ['Choose a problem', 'Design it', 'Submit', 'Get feedback', 'Review', 'Try again'];

export function ProblemsPage() {
  const problems = useProblems();
  return (
    <main className="page">
      <section className="hero">
        <h1>Practice low-level design, and see whether you are getting better.</h1>
        <p>Pick a problem, design your classes, and get feedback you can check: every point is tied to something in your own design, with what to try next. Then revise and see what changed.</p>
        <div className="loop" aria-label="The practice loop">
          {STEPS.map((s, i) => (
            <span key={s} style={{ display: 'contents' }}>
              <span className="loop-step"><span className="n">{i + 1}</span>{s}</span>
              {i < STEPS.length - 1 && <span className="loop-arrow" aria-hidden>→</span>}
            </span>
          ))}
        </div>
      </section>

      {problems.isLoading && <Loading label="Loading problems…" />}
      {problems.isError && <ErrorNotice error={problems.error} retry={() => problems.refetch()} />}
      <div className="grid">
        {problems.data?.map((p) => (
          <Link key={p.id} to={`/problems/${p.id}`} className="card problem-card">
            <div className="row-between">
              <Pill tone={p.difficulty === 'easy' ? 'good' : p.difficulty === 'medium' ? 'warn' : 'bad'}>{DIFFICULTY_LABELS[p.difficulty]}</Pill>
              <span className="small muted">~{p.estimatedMinutes} min</span>
            </div>
            <div className="stack-sm" style={{ gap: 6 }}>
              <h3>{p.title}</h3>
              <p className="muted small" style={{ margin: 0 }}>{p.tagline}</p>
            </div>
            <div className="row" style={{ gap: 6 }}>{p.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
            <div className="foot">
              {p.openDraftId ? <Pill tone="accent">Draft in progress</Pill> : p.attemptCount === 0 ? <span className="muted">Not attempted</span> : <span className="muted">{p.attemptCount} attempt{p.attemptCount === 1 ? '' : 's'}</span>}
              {p.latestScore !== undefined && (
                <span className="row" style={{ gap: 6 }}>
                  <span className="muted">Latest</span><b className="score-mini">{p.latestScore.toFixed(1)}</b><Pill tone={bandTone(p.latestBand)}>{p.latestBand}</Pill>
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
