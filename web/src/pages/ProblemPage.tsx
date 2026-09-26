import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProblemBrief } from '../components/ProblemBrief';
import { ProgressSection } from '../components/ProgressSection';
import { Approaches } from '../components/review/Approaches';
import { ErrorNotice, Loading, Notice, Pill, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { DIFFICULTY_LABELS, STATUS_LABELS } from '../lib/labels';
import { useProblem, useProgress, useStartAttempt } from '../lib/queries';

export function ProblemPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const problem = useProblem(id);
  const progress = useProgress(id);
  const start = useStartAttempt();

  if (problem.isLoading) return <main className="page"><Loading /></main>;
  if (problem.isError) {
    const missing = problem.error instanceof ApiError && problem.error.status === 404;
    return <main className="page">{missing ? <div className="empty">That problem does not exist. <Link to="/">Back to problems</Link></div> : <ErrorNotice error={problem.error} retry={() => problem.refetch()} />}</main>;
  }
  const p = problem.data!;
  const attempts = progress.data?.attempts ?? [];
  const draft = attempts.find((a) => a.status === 'DRAFT');
  const submitted = attempts.filter((a) => a.status !== 'DRAFT').sort((a, b) => b.number - a.number);
  const latest = submitted[0];
  const hasSubmitted = submitted.length > 0;

  const begin = async (basedOn?: string) => {
    const attempt = await start.mutateAsync({ problemId: p.id, basedOnAttemptId: basedOn });
    navigate(`/attempts/${attempt.id}`);
  };

  return (
    <main className="page">
      <div className="crumbs"><Link to="/">Problems</Link> / {p.title}</div>
      <div className="row-between" style={{ marginBottom: 20 }}>
        <div className="stack-sm">
          <div className="row"><h1>{p.title}</h1><Pill tone={p.difficulty === 'easy' ? 'good' : p.difficulty === 'medium' ? 'warn' : 'bad'}>{DIFFICULTY_LABELS[p.difficulty]}</Pill><span className="muted small">~{p.estimatedMinutes} min</span></div>
          <p className="muted" style={{ margin: 0, maxWidth: '70ch' }}>{p.context}</p>
        </div>
      </div>

      <div className="brief-grid">
        <div className="stack">
          <ProblemBrief problem={p} compact />
          <section className="card card-pad stack-sm">
            <h2>You will also be asked</h2>
            <p className="help">After designing, you stress-test your design against realistic change requests:</p>
            <ul className="stack-sm" style={{ paddingLeft: 18 }}>{p.scenarios.map((s) => <li key={s.id}>{s.prompt}</li>)}</ul>
          </section>
          {progress.data && progress.data.attempts.length > 0 && <ProgressSection progress={progress.data} />}
          {hasSubmitted && <Approaches problemId={p.id} />}
        </div>

        <aside className="stack side-sticky">
          <div className="card card-pad stack">
            <h2>{draft ? 'Pick up where you left off' : hasSubmitted ? 'Try again' : 'Ready when you are'}</h2>
            {!draft && !hasSubmitted && <p className="muted small" style={{ margin: 0 }}>You will clarify the problem, sketch your classes, answer a few "what if?" questions and explain your choices. Feedback follows immediately.</p>}
            {hasSubmitted && !draft && latest && <p className="muted small" style={{ margin: 0 }}>Your last attempt (#{latest.number}) was {STATUS_LABELS[latest.status].toLowerCase()}. Revising starts from your submission, so you keep what worked and fix what did not.</p>}
            {draft && <p className="muted small" style={{ margin: 0 }}>Attempt #{draft.number} is still a draft. Your work was saved as you went.</p>}
            {draft ? (
              <button className="btn btn-primary btn-lg" onClick={() => navigate(`/attempts/${draft.id}`)}>Continue draft #{draft.number}</button>
            ) : hasSubmitted && latest ? (
              <>
                <button className="btn btn-primary btn-lg" disabled={start.isPending} onClick={() => begin(latest.id)}>{start.isPending && <Spinner />} Revise attempt #{latest.number}</button>
                <button className="btn" disabled={start.isPending} onClick={() => begin()}>Start from scratch</button>
              </>
            ) : (
              <button className="btn btn-primary btn-lg" disabled={start.isPending} onClick={() => begin()}>{start.isPending && <Spinner />} Start attempt</button>
            )}
            {start.isError && <Notice tone="warn" title={start.error.message} />}
          </div>
        </aside>
      </div>
    </main>
  );
}
