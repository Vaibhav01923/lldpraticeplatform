import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AttemptDto, ProblemDto } from '../../../../shared/contracts';
import { hintsWereOpened } from '../../lib/hints';
import { STATUS_LABELS, formatWhen } from '../../lib/labels';
import { useStartAttempt } from '../../lib/queries';
import { Notice, Pill, Spinner } from '../ui';
import { Approaches } from './Approaches';
import { CoverageTable } from './CoverageTable';
import { EvaluationBanner } from './EvaluationBanner';
import { Findings } from './Findings';
import { NextSteps } from './NextSteps';
import { Scorecard } from './Scorecard';
import { SubmissionView } from './SubmissionView';

/** Feedback → Review → Try again. */
export function ReviewView({ attempt, problem }: { attempt: AttemptDto; problem: ProblemDto }) {
  const navigate = useNavigate();
  const start = useStartAttempt();
  const report = attempt.report;

  const begin = async (basedOn?: string) => {
    const next = await start.mutateAsync({ problemId: problem.id, basedOnAttemptId: basedOn });
    navigate(`/attempts/${next.id}`);
    window.scrollTo({ top: 0 });
  };

  const settled = attempt.status === 'EVALUATED' || attempt.status === 'PARTIALLY_EVALUATED';
  const failed = attempt.status === 'EVALUATION_FAILED';

  // Let the learner see progress from another tab.
  useEffect(() => {
    const previous = document.title;
    document.title = settled ? `Feedback ready · ${problem.title}` : failed ? `Could not evaluate · ${problem.title}` : `Evaluating… · ${problem.title}`;
    return () => {
      document.title = previous;
    };
  }, [settled, failed, problem.title]);

  return (
    <main className="page">
      <div className="crumbs"><Link to="/">Problems</Link> / <Link to={`/problems/${problem.id}`}>{problem.title}</Link> / Attempt #{attempt.number}</div>
      <div className="row-between" style={{ marginBottom: 18 }}>
        <div>
          <h1>Attempt #{attempt.number}: {problem.title}</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Submitted {formatWhen(attempt.submittedAt)} · <Pill tone={settled ? (attempt.status === 'EVALUATED' ? 'good' : 'warn') : 'info'}>{STATUS_LABELS[attempt.status]}</Pill>
            {report && !report.provisional && report.runs.length > 0 && (
              <span className="faint"> · reviewed by {report.runs.map((r) => (r.model ? `${r.label} (${r.model})` : r.label)).join(', ')}</span>
            )}
          </p>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => begin(attempt.id)} disabled={start.isPending || !attempt.submission}>
            {start.isPending && <Spinner />} Revise this attempt
          </button>
          <button className="btn" onClick={() => begin()} disabled={start.isPending}>Start over</button>
        </div>
      </div>
      {start.isError && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warn" title={start.error.message}>
            <Link to={`/problems/${problem.id}`}>Go to the problem page</Link> to continue your draft.
          </Notice>
        </div>
      )}

      <div className="stack">
        <EvaluationBanner attempt={attempt} />
        {hintsWereOpened(attempt.id) && (
          <Notice tone="info" title="You opened the hints on this attempt">
            That is fine. As you read the feedback, notice which points you would have found on your own. The ones you would not have are exactly what to practise next.
          </Notice>
        )}
        {report ? (
          <div className="review-grid">
            <div className="stack">
              <NextSteps report={report} />
              {report.summary && (
                <section className="card card-pad stack-sm">
                  <h2>Reviewer's summary</h2>
                  <p style={{ margin: 0 }}>{report.summary}</p>
                  {report.reflectionQuestions.length > 0 && (
                    <>
                      <h3 style={{ marginTop: 8 }}>Questions to think about</h3>
                      <ul className="reflect" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {report.reflectionQuestions.map((q) => <li key={q}>{q}</li>)}
                      </ul>
                    </>
                  )}
                </section>
              )}
              {report.alternatives.length > 0 && (
                <section className="stack-sm">
                  <h2>Valid alternatives you chose</h2>
                  {report.alternatives.map((a) => (
                    <div key={a.observation} className="alt stack-sm" style={{ gap: 4 }}>
                      <b>{a.observation}</b>
                      <span className="small">{a.whyValid}</span>
                      <span className="small muted"><b>Be ready to explain: </b>{a.tradeoff}</span>
                    </div>
                  ))}
                </section>
              )}
              <Findings report={report} />
              <CoverageTable coverage={report.coverage} />
              {attempt.submission && <SubmissionView submission={attempt.submission} problem={problem} />}
              {settled && <Approaches problemId={problem.id} />}
            </div>
            <aside className="stack side-sticky">
              <Scorecard report={report} />
            </aside>
          </div>
        ) : (
          attempt.status !== 'EVALUATION_FAILED' && (
            <div className="card">
              <div className="empty row" style={{ justifyContent: 'center' }}><Spinner /> Preparing your feedback…</div>
            </div>
          )
        )}
        {!report && attempt.submission && <SubmissionView submission={attempt.submission} problem={problem} />}
      </div>
    </main>
  );
}
