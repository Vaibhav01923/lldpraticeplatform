import { Link, useParams } from 'react-router-dom';
import { ReviewView } from '../components/review/ReviewView';
import { Workspace } from '../components/Workspace';
import { ErrorNotice, Loading } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAttempt, useProblem } from '../lib/queries';

/** One URL for an attempt: a workspace while it is a draft, the review once it has been submitted. */
export function AttemptPage() {
  const { id = '' } = useParams();
  const attempt = useAttempt(id);
  const problem = useProblem(attempt.data?.problemId ?? '');

  if (attempt.isLoading) return <main className="page"><Loading /></main>;
  if (attempt.isError) {
    const missing = attempt.error instanceof ApiError && attempt.error.status === 404;
    return <main className="page">{missing ? <div className="empty">We could not find that attempt. It may belong to a different browser. <Link to="/">Back to problems</Link></div> : <ErrorNotice error={attempt.error} retry={() => attempt.refetch()} />}</main>;
  }
  if (problem.isError) return <main className="page"><ErrorNotice error={problem.error} retry={() => problem.refetch()} /></main>;
  if (!attempt.data || !problem.data) return <main className="page"><Loading /></main>;

  return attempt.data.status === 'DRAFT'
    ? <Workspace key={attempt.data.id} attempt={attempt.data} problem={problem.data} />
    : <ReviewView attempt={attempt.data} problem={problem.data} />;
}
