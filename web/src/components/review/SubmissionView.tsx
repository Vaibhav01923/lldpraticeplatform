import type { ProblemDto, SubmissionDto } from '../../../../shared/contracts';
import { DiagramPreview } from '../DiagramPreview';

/** What was submitted, read-only, so feedback can be checked against the design it is about. */
export function SubmissionView({ submission, problem }: { submission: SubmissionDto; problem: ProblemDto }) {
  return (
    <section className="card card-pad stack-sm" aria-labelledby="sub-h">
      <h2 id="sub-h">What you submitted</h2>
      <DiagramPreview model={submission.model} />
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Your write-up</summary>
        <div className="stack-sm" style={{ marginTop: 10 }}>
          <div><h4 className="small muted">Assumptions</h4><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{submission.assumptions || '—'}</p></div>
          {problem.scenarios.map((s) => (
            <div key={s.id}><h4 className="small muted">{s.id}. {s.prompt}</h4><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{submission.scenarioAnswers[s.id] || '—'}</p></div>
          ))}
          <div><h4 className="small muted">Decisions</h4><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{submission.decisions || '—'}</p></div>
        </div>
      </details>
    </section>
  );
}
