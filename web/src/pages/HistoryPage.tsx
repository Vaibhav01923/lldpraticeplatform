import { Link } from 'react-router-dom';
import { AttemptsTable } from '../components/ProgressSection';
import { ErrorNotice, Loading } from '../components/ui';
import { useAttempts } from '../lib/queries';

export function HistoryPage() {
  const attempts = useAttempts();
  return (
    <main className="page page-narrow">
      <h1 style={{ marginBottom: 6 }}>My attempts</h1>
      <p className="muted" style={{ marginBottom: 20 }}>Everything you have tried, newest first. Open the problem page to see how you are improving on it.</p>
      {attempts.isLoading && <Loading />}
      {attempts.isError && <ErrorNotice error={attempts.error} retry={() => attempts.refetch()} />}
      {attempts.data && (attempts.data.length === 0 ? <div className="empty card">Nothing here yet. <Link to="/">Pick a problem to start.</Link></div> : <AttemptsTable attempts={attempts.data} showProblem />)}
    </main>
  );
}
