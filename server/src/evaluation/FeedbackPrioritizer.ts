import type { Confidence, DimensionId, FindingDto, NextStepDto, Severity } from '../../../shared/contracts';
import type { Rubric } from '../domain/evaluation/Rubric';

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 10, major: 6, minor: 2, strength: 0 };
const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.75, low: 0.5 };

/**
 * Feedback is only useful if the learner knows what to do first. This ranks findings by
 * severity × confidence × how much the dimension counts, demotes findings the AI reviewer has disputed,
 * and picks a short "do these next" list, with at most two per dimension so the advice is spread across
 * the design rather than piling onto one weakness.
 */
export class FeedbackPrioritizer {
  constructor(private readonly maxNextSteps = 3, private readonly maxPerDimension = 2) {}

  prioritize(findings: readonly FindingDto[], rubric: Rubric): { ordered: FindingDto[]; nextSteps: NextStepDto[] } {
    const weight = (dim: DimensionId) => rubric.dimension(dim).weight;
    const rank = (f: FindingDto) => SEVERITY_WEIGHT[f.severity] * CONFIDENCE_WEIGHT[f.confidence] * (0.5 + weight(f.dimension)) * (f.disputedReason ? 0.3 : 1);

    const problems = findings.filter((f) => f.severity !== 'strength').sort((a, b) => rank(b) - rank(a));
    const strengths = findings.filter((f) => f.severity === 'strength');

    const perDimension = new Map<DimensionId, number>();
    const nextSteps: NextStepDto[] = [];
    for (const f of problems) {
      if (nextSteps.length >= this.maxNextSteps) break;
      if (f.disputedReason) continue; // never lead with something a reviewer thinks may not apply
      const used = perDimension.get(f.dimension) ?? 0;
      if (used >= this.maxPerDimension) continue;
      perDimension.set(f.dimension, used + 1);
      nextSteps.push({ findingId: f.id, headline: f.title, action: f.suggestion ?? f.detail });
    }
    return { ordered: [...problems, ...strengths], nextSteps };
  }
}
