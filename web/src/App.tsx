import { NavLink, Route, Routes, Link } from 'react-router-dom';
import { useMeta } from './lib/queries';
import { AttemptPage } from './pages/AttemptPage';
import { HistoryPage } from './pages/HistoryPage';
import { ProblemPage } from './pages/ProblemPage';
import { ProblemsPage } from './pages/ProblemsPage';

export function App() {
  const meta = useMeta();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="6" width="10" height="8" rx="1.5" />
                <rect x="17" y="18" width="10" height="8" rx="1.5" />
                <path d="M15 10h4a2 2 0 0 1 2 2v6" />
              </svg>
            </span>
            LLD Practice
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Problems</NavLink>
            <NavLink to="/history">My attempts</NavLink>
          </nav>
          {meta.data && (
            <span className={`ai-chip ${meta.data.aiEnabled ? 'on' : ''}`} title={meta.data.aiEnabled ? `Reviews use ${meta.data.aiModel}` : 'Feedback comes from structural checks only'}>
              <span className="dot" />
              {meta.data.aiEnabled ? `AI review · ${meta.data.aiModel}` : 'AI review off'}
            </span>
          )}
        </div>
      </header>
      <Routes>
        <Route path="/" element={<ProblemsPage />} />
        <Route path="/problems/:id" element={<ProblemPage />} />
        <Route path="/attempts/:id" element={<AttemptPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="*" element={<main className="page"><div className="empty">That page does not exist. <Link to="/">Back to problems</Link></div></main>} />
      </Routes>
      <footer className="footer">Your attempts are stored under an anonymous id in this browser. There are no accounts in this prototype.</footer>
    </>
  );
}
