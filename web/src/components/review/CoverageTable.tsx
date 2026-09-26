import type { CapabilityCoverageDto } from '../../../../shared/contracts';
import { Pill } from '../ui';

const STATUS = { covered: ['good', 'Has an owner'], partial: ['warn', 'Mentioned only'], missing: ['bad', 'No owner'] } as const;

/** Requirements traceability: for every capability the problem needs, which of your classes owns it. */
export function CoverageTable({ coverage }: { coverage: CapabilityCoverageDto[] }) {
  if (coverage.length === 0) return null;
  return (
    <section className="card card-pad stack-sm" aria-labelledby="cov-h">
      <h2 id="cov-h">Do your classes cover the requirements?</h2>
      <p className="help">For each thing the problem needs, this shows which of your classes owns it. It matches on vocabulary, so different names for the same idea are fine.</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="coverage">
          <thead><tr><th>Capability</th><th>Requirements</th><th>Status</th><th>Your classes</th></tr></thead>
          <tbody>
            {coverage.map((c) => {
              const [tone, label] = STATUS[c.status];
              return (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>{c.requirementIds.map((r) => <span key={r} className="chip" style={{ marginRight: 4 }}>{r}</span>)}</td>
                  <td><Pill tone={tone}>{label}</Pill></td>
                  <td>{c.matchedClasses.length ? c.matchedClasses.map((m) => <span key={m} className="chip" style={{ marginRight: 4 }}>{m}</span>) : <span className="faint">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
