import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AttemptDto, DraftInputDto, PreflightDto, ProblemDto } from '../../../shared/contracts';
import { ApiError } from '../lib/api';
import { useAutosave, type SaveState } from '../lib/hooks';
import { useDiscardAttempt, useMeta, useSubmitAttempt } from '../lib/queries';
import { wordCount } from '../lib/text';
import { DesignSection } from './DesignSection';
import { ProblemBrief } from './ProblemBrief';
import { Notice, Spinner } from './ui';

const SAVE_TEXT: Record<SaveState, string> = { saved: 'All changes saved', dirty: 'Unsaved changes…', saving: 'Saving…', error: 'Could not save. Retrying on your next edit', conflict: 'Not saved: changed elsewhere' };

/** The practice surface: clarify, design, stress-test, explain, submit. Autosaves as you go. */
export function Workspace({ attempt, problem }: { attempt: AttemptDto; problem: ProblemDto }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useMeta();
  const submit = useSubmitAttempt();
  const discard = useDiscardAttempt();

  const [draft, setDraft] = useState<DraftInputDto>({
    format: attempt.draft.format,
    design: attempt.draft.design,
    assumptions: attempt.draft.assumptions,
    decisions: attempt.draft.decisions,
    scenarioAnswers: attempt.draft.scenarioAnswers,
  });
  const [preflight, setPreflight] = useState<PreflightDto | undefined>();
  const { state, error, saveNow } = useAutosave(attempt.id, draft, attempt.draft.revision, true, (saved) => qc.setQueryData(['attempt', saved.id], saved));

  const patch = (p: Partial<DraftInputDto>) => setDraft((d) => ({ ...d, ...p }));
  const onPreflight = useCallback((r: PreflightDto | undefined) => setPreflight(r), []);

  const checks = useMemo(() => {
    const stats = preflight?.stats;
    return [
      { done: wordCount(draft.assumptions) >= 8, label: 'State your assumptions' },
      { done: !!preflight?.ok && (stats?.classes ?? 0) >= 3, label: 'Sketch at least three classes' },
      { done: !!stats && stats.classes > 0 && stats.withResponsibility === stats.classes, label: 'Give every class a responsibility' },
      { done: problem.scenarios.every((s) => wordCount(draft.scenarioAnswers[s.id] ?? '') >= 12), label: 'Answer every change scenario' },
      { done: wordCount(draft.decisions) >= 15, label: 'Explain the choices you made' },
    ];
  }, [draft, preflight, problem.scenarios]);
  const remaining = checks.filter((c) => !c.done).length;
  const designBroken = preflight?.ok === false;

  const onSubmit = async () => {
    const saved = await saveNow();
    if (!saved) return;
    try {
      await submit.mutateAsync(attempt.id);
      window.scrollTo({ top: 0 });
    } catch {
      /* shown below from submit.error */
    }
  };

  const submitError = submit.error;
  const submitIssues = submitError instanceof ApiError && Array.isArray(submitError.details) ? (submitError.details as { message: string }[]) : [];

  return (
    <>
      <div className="ws-bar">
        <div className="ws-bar-inner">
          <div className="grow">
            <div className="crumbs" style={{ margin: 0 }}>
              <Link to={`/problems/${problem.id}`}>{problem.title}</Link> · Attempt #{attempt.number}
              {attempt.basedOnAttemptId && <span> · revising an earlier attempt</span>}
            </div>
          </div>
          <span className={`save-state ${state === 'error' || state === 'conflict' ? 'bad' : ''}`} aria-live="polite">
            {state === 'saving' && <Spinner />}
            {SAVE_TEXT[state]}
          </span>
          <button
            className="btn btn-ghost btn-sm btn-danger"
            disabled={discard.isPending}
            onClick={async () => {
              if (window.confirm('Discard this draft? This cannot be undone.')) {
                await discard.mutateAsync(attempt.id);
                navigate(`/problems/${problem.id}`);
              }
            }}
          >
            Discard
          </button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={submit.isPending || state === 'conflict' || designBroken} title={designBroken ? 'Fix the issues in your design first' : undefined}>
            {submit.isPending ? <Spinner /> : null} Submit for feedback
          </button>
        </div>
      </div>

      <main className="page">
        <div className="ws-grid">
          <aside className="ws-brief">
            <ProblemBrief problem={problem} compact attemptId={attempt.id} />
          </aside>

          <div className="stack">
            {state === 'conflict' && (
              <Notice tone="bad" title="This draft was changed somewhere else" action={<button className="btn btn-sm" onClick={() => window.location.reload()}>Reload</button>}>
                {error} Your latest edits here were not saved. Copy anything you need, then reload.
              </Notice>
            )}
            {state === 'error' && <Notice tone="warn" title="Could not save your latest changes">{error} We will try again when you next edit.</Notice>}

            <section className="card card-pad stack-sm">
              <div className="section-title"><span className="step-num">1</span><h2>Clarify the problem</h2></div>
              <p className="help">Prompts are deliberately vague. Write down what you are assuming: scope, what happens when things go wrong, limits, and what you are choosing not to handle.</p>
              <textarea className="textarea" rows={5} value={draft.assumptions} onChange={(e) => patch({ assumptions: e.target.value })} placeholder={'One lot, one currency.\nA full lot refuses entry.\nNo reservations.'} aria-label="Assumptions" />
            </section>

            <section className="card card-pad stack-sm">
              <div className="section-title"><span className="step-num">2</span><h2>Design it</h2></div>
              <p className="help">Decide which things deserve to be classes, what each is responsible for, and how they collaborate.</p>
              {meta.data ? (
                <DesignSection formats={meta.data.formats} format={draft.format} design={draft.design} onChange={(format, design) => patch({ format, design })} onPreflight={onPreflight} />
              ) : (
                <Spinner />
              )}
            </section>

            <section className="card card-pad stack-sm">
              <div className="section-title"><span className="step-num">3</span><h2>Stress-test it</h2></div>
              <p className="help">Requirements change. For each request below, say which of your classes you would <b>add</b> and which you would have to <b>edit</b>. Fewer edits means a more extensible design.</p>
              {problem.scenarios.map((s) => (
                <div key={s.id} className="scenario">
                  <div className="q"><span className="id">{s.id}</span>{s.prompt}</div>
                  <textarea
                    className="textarea"
                    rows={3}
                    value={draft.scenarioAnswers[s.id] ?? ''}
                    onChange={(e) => patch({ scenarioAnswers: { ...draft.scenarioAnswers, [s.id]: e.target.value } })}
                    placeholder="I would add … implementing …, and … would not change because …"
                    aria-label={`Answer to change scenario ${s.id}`}
                  />
                </div>
              ))}
            </section>

            <section className="card card-pad stack-sm">
              <div className="section-title"><span className="step-num">4</span><h2>Explain your choices</h2></div>
              <p className="help">For your two or three most important decisions: what you chose, <b>why</b>, and what you gave up. Naming the alternative you rejected is the strongest thing you can do here.</p>
              <textarea className="textarea" rows={6} value={draft.decisions} onChange={(e) => patch({ decisions: e.target.value })} placeholder="I used a Strategy for pricing because rates change often, instead of hard-coding them in ParkingLot. The trade-off is one more type to read." aria-label="Design decisions" />
            </section>

            <section className="card card-pad stack">
              <div className="section-title"><span className="step-num">✓</span><h2>Ready?</h2></div>
              <ul className="stack-sm" style={{ listStyle: 'none', padding: 0 }}>
                {checks.map((c) => (
                  <li key={c.label} className="row" style={{ gap: 8 }}>
                    <span className={`pill ${c.done ? 'good' : ''}`} aria-hidden>{c.done ? '✓' : '○'}</span>
                    <span className={c.done ? '' : 'muted'}>{c.label}</span>
                  </li>
                ))}
              </ul>
              {remaining > 0 && <p className="help">You can submit any time. The feedback will point out what is missing, and you can revise and try again.</p>}
              {submit.isError && (
                <Notice tone="bad" title={submitError instanceof Error ? submitError.message : 'Could not submit'}>
                  {submitIssues.length > 0 && <ul style={{ margin: 0 }}>{submitIssues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>}
                </Notice>
              )}
              <div>
                <button className="btn btn-primary btn-lg" onClick={onSubmit} disabled={submit.isPending || state === 'conflict' || designBroken}>
                  {submit.isPending ? <Spinner /> : null} Submit for feedback
                </button>
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
