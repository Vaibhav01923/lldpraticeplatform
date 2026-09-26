import type { ReactNode } from 'react';
import { bandTone } from '../lib/labels';

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Working" />;
}

export function Pill({ tone = 'muted', children, title }: { tone?: 'muted' | 'good' | 'info' | 'warn' | 'bad' | 'accent'; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${tone === 'muted' ? '' : tone}`} title={title}>
      {children}
    </span>
  );
}

export function BandPill({ band }: { band: string | undefined }) {
  if (!band) return null;
  return <Pill tone={bandTone(band)}>{band}</Pill>;
}

const ICONS = {
  info: <path d="M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" />,
  warn: <path d="M12 9v4m0 4h.01M10.3 4.2 2.7 17.5A2 2 0 0 0 4.4 20.5h15.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />,
  bad: <path d="M12 8v5m0 3h.01M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" />,
  good: <path d="m8 12.5 2.8 2.8L16.5 9.5M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" />,
} as const;

export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: string; children?: ReactNode; action?: ReactNode }) {
  const color = { info: 'var(--info)', warn: 'var(--warn)', bad: 'var(--bad)', good: 'var(--good)' }[tone];
  return (
    <div className={`notice ${tone}`} role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'}>
      <span className="notice-icon" style={{ color }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {ICONS[tone]}
        </svg>
      </span>
      <div className="grow stack-sm" style={{ gap: 4 }}>
        {title && <div className="notice-title">{title}</div>}
        {children && <div className="small">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="empty row" style={{ justifyContent: 'center' }}>
      <Spinner /> {label}
    </div>
  );
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <Notice
      tone="bad"
      title="That didn't work"
      action={retry && <button className="btn btn-sm" onClick={retry}>Try again</button>}
    >
      {message}
    </Notice>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`chev ${open ? 'open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** A 0–4 score bar. */
export function ScoreBar({ score, band }: { score: number; band: string }) {
  return (
    <div className={`bar ${bandTone(band)}`} role="img" aria-label={`${score.toFixed(1)} out of 4, ${band}`}>
      <span style={{ width: `${Math.min(100, (score / 4) * 100)}%` }} />
    </div>
  );
}
