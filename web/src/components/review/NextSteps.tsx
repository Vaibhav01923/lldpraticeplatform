import type { EvaluationReportDto } from '../../../../shared/contracts';
import { anchorId } from './Findings';

const jumpTo = (id: string) => {
  const el = document.getElementById(anchorId(id));
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('flash');
};

export function NextSteps({ report }: { report: EvaluationReportDto }) {
  if (report.nextSteps.length === 0) {
    return (
      <section className="card card-pad stack-sm">
        <h2>Nothing urgent</h2>
        <p className="muted" style={{ margin: 0 }}>No structural problems stood out. Read the feedback below for smaller improvements, then compare your approach with the common ones.</p>
      </section>
    );
  }
  return (
    <section className="stack-sm" aria-labelledby="next-h">
      <h2 id="next-h">Do these next</h2>
      <div className="next-steps">
        {report.nextSteps.map((s, i) => (
          <div key={s.findingId} className="next-step">
            <span className="num" aria-hidden>{i + 1}</span>
            <div className="stack-sm" style={{ gap: 3 }}>
              <div className="headline">{s.headline}</div>
              <div className="small">{s.action}</div>
              <a href={`#${anchorId(s.findingId)}`} onClick={(e) => { e.preventDefault(); jumpTo(s.findingId); }}>Why? See the details</a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
