import { useApproaches } from '../../lib/queries';
import { ErrorNotice, Loading, Pill } from '../ui';

/** Known-valid ways to solve the problem. Unlocked by submitting: compare after trying, not instead of trying. */
export function Approaches({ problemId }: { problemId: string }) {
  const q = useApproaches(problemId, true);
  return (
    <section className="stack-sm" aria-labelledby="appr-h">
      <h2 id="appr-h">Common approaches</h2>
      <p className="help">There is rarely one right answer. These are well-known shapes for this problem. Compare them with yours, and notice what each trades away.</p>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorNotice error={q.error} />}
      {q.data?.map((a) => (
        <article key={a.title} className="approach">
          <div className="row-between"><h3>{a.title}</h3><div className="row" style={{ gap: 6 }}>{a.patterns.map((p) => <Pill key={p} tone="accent">{p}</Pill>)}</div></div>
          <p className="muted" style={{ margin: '6px 0 0' }}>{a.summary}</p>
          <dl>
            <dt>Fits when</dt><dd>{a.whenItFits}</dd>
            <dt>Trade-offs</dt><dd><ul style={{ margin: 0, paddingLeft: 18 }}>{a.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul></dd>
          </dl>
        </article>
      ))}
    </section>
  );
}
