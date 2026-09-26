import type { AttemptDto } from '../../../../shared/contracts';
import { MAX_RUNS } from '../../lib/constants';
import { useNow } from '../../lib/hooks';
import { useRetryEvaluation } from '../../lib/queries';
import { Notice, Spinner } from '../ui';

/**
 * Tells the learner, plainly, where evaluation stands and what they can do about it. This is where
 * "evaluation is slow" and "evaluation failed" become visible states with a next action, not a spinner forever.
 */
export function EvaluationBanner({ attempt }: { attempt: AttemptDto }) {
  const retry = useRetryEvaluation();
  const evaluating = attempt.status === 'EVALUATING' || attempt.status === 'SUBMITTED';
  const now = useNow(evaluating);
  const report = attempt.report;
  const since = attempt.evaluation.lastStartedAt ? Math.max(0, Math.round((now - new Date(attempt.evaluation.lastStartedAt).getTime()) / 1000)) : 0;
  const retriesLeft = Math.max(0, MAX_RUNS - attempt.evaluation.runsStarted);

  const retryButton = (label: string) => (
    <button className="btn btn-sm" disabled={retry.isPending || retriesLeft === 0} onClick={() => retry.mutate(attempt.id)}>
      {retry.isPending && <Spinner />} {label}
    </button>
  );
  const retryError = retry.isError ? <p style={{ margin: '6px 0 0', color: 'var(--bad)' }}>{retry.error.message}</p> : null;

  switch (attempt.status) {
    case 'SUBMITTED':
      return (
        <Notice tone="info" title="Queued for evaluation">
          <span className="row"><Spinner /> Your submission is saved. Evaluation starts in a moment.</span>
        </Notice>
      );
    case 'EVALUATING':
      return (
        <Notice tone="info" title={report?.provisional ? 'Structural feedback is ready. The AI review is still running' : 'Running structural checks'}>
          <span className="row">
            <Spinner />
            {report?.provisional
              ? `You can read the structural findings below now. The AI review has been running for ${since}s and this page will update when it finishes.`
              : 'This usually takes a second or two.'}
          </span>
        </Notice>
      );
    case 'PARTIALLY_EVALUATED': {
      const failed = report?.runs.filter((r) => r.status !== 'ok') ?? [];
      return (
        <Notice tone="warn" title="Part of the review did not finish" action={retryButton('Retry the review')}>
          <p style={{ margin: 0 }}>
            The structural checks completed, so the feedback below is real. What is missing:{' '}
            {failed.map((r) => r.label).join(' and ') || 'part of the review'}
            {failed[0]?.error ? ` (${failed[0].error.replace(/\.$/, '')})` : ''}. Scores use only the checks that ran, and cannot reach the top band without the AI review.
          </p>
          {retriesLeft > 0 ? <p style={{ margin: '4px 0 0' }} className="faint">{retriesLeft} retr{retriesLeft === 1 ? 'y' : 'ies'} left for this attempt.</p> : <p style={{ margin: '4px 0 0' }}>No retries left for this attempt. Revise it as a new attempt instead.</p>}
          {retryError}
        </Notice>
      );
    }
    case 'EVALUATION_FAILED':
      return (
        <Notice tone="bad" title="We could not evaluate this attempt" action={retryButton('Try again')}>
          <p style={{ margin: 0 }}>{attempt.evaluation.lastError ?? 'Something went wrong.'} Your submission is safe.</p>
          {retryError}
        </Notice>
      );
    case 'EVALUATED':
      if (!attempt.aiEnabled) {
        return (
          <Notice tone="info" title="Feedback from structural checks only">
            The AI review is off on this server, so this feedback covers structure, coverage and communication, but not judgement calls like whether a responsibility is cohesive. Set <code>ANTHROPIC_API_KEY</code> to switch it on.
          </Notice>
        );
      }
      return null;
    default:
      return null;
  }
}
