import type { DimensionId, DimensionScoreDto, FindingSource } from '../../../shared/contracts';
import { clamp, Rubric, round1 } from '../domain/evaluation/Rubric';
import type { DimensionAssessment, Evaluator, EvaluatorResult } from './Evaluator';

export interface EvaluatorOutput {
  evaluator: Pick<Evaluator, 'id' | 'kind' | 'label'>;
  result: EvaluatorResult;
}

export interface AggregationPolicy {
  /** Share of a dimension's score that comes from the deterministic checks when an AI review also exists. */
  deterministicWeight: number;
  aiWeight: number;
  /** The AI may be at most this much more generous than the structural checks… */
  aiMaxRaise: number;
  /** …and at most this much harsher. Being asymmetric is deliberate: praise must be earned by evidence. */
  aiMaxLower: number;
  /**
   * Ceiling for a dimension that only structural checks have judged. 3.4 is deliberately the highest score that still
   * reads "Solid": scores round to 0.1 and 3.5 is the "Strong" band, so a higher cap would let a design that no AI has
   * reviewed be called Strong. (A guard test fails if this is raised into the Strong band.) Rules can confirm a design is well formed,
   * but not that responsibilities are cohesive or trade-offs sound, so they cannot on their own award the top band.
   */
  structuralOnlyMax: number;
}

export const DEFAULT_POLICY: AggregationPolicy = { deterministicWeight: 0.4, aiWeight: 0.6, aiMaxRaise: 1, aiMaxLower: 2, structuralOnlyMax: 3.4 };

/**
 * Turns several evaluators' opinions into one score per dimension.
 *
 * The guardrails are the interesting part. An LLM can judge things rules cannot (is this responsibility
 * cohesive? is this trade-off sound?) but it can also be too kind, be talked into praise, or hallucinate.
 * So: the AI's score is bounded relative to the structural score, and any cap a deterministic rule
 * emits (for example "fewer than three classes") binds the final result whatever the AI thinks.
 */
export class ScoreAggregator {
  constructor(private readonly policy: AggregationPolicy = DEFAULT_POLICY) {}

  aggregate(rubric: Rubric, outputs: readonly EvaluatorOutput[]): { dimensions: DimensionScoreDto[]; overall: number; band: string } {
    const dimensions = rubric.dimensions.map((dim): DimensionScoreDto => {
      const det = average(outputs.filter((o) => o.evaluator.kind === 'deterministic'), dim.id);
      const ai = average(outputs.filter((o) => o.evaluator.kind === 'ai'), dim.id);
      const rationale: string[] = [...(det?.rationale ?? [])];
      const sources: FindingSource[] = [];
      if (det) sources.push('rules');
      if (ai) sources.push('ai');

      let score: number;
      if (det && ai) {
        const bounded = clamp(ai.score, det.score - this.policy.aiMaxLower, det.score + this.policy.aiMaxRaise);
        if (bounded !== ai.score) {
          rationale.push(
            `The AI review scored this ${ai.score.toFixed(1)}, which differs a lot from the structural checks (${det.score.toFixed(1)}), so it was limited to ${bounded.toFixed(1)}.`,
          );
        }
        score = (this.policy.deterministicWeight * det.score + this.policy.aiWeight * bounded) / (this.policy.deterministicWeight + this.policy.aiWeight);
      } else if (det || ai) {
        score = (det ?? ai)!.score;
      } else {
        score = 0;
        rationale.push('This dimension could not be assessed.');
      }
      if (ai) rationale.push(...ai.rationale.map((r) => `AI review: ${r}`));

      const caps: string[] = [];
      if (det && !ai && score > this.policy.structuralOnlyMax) {
        score = this.policy.structuralOnlyMax;
        caps.push(`Capped at ${this.policy.structuralOnlyMax.toFixed(1)}: structural checks alone cannot confirm cohesion or sound trade-offs, so the top band needs an AI review.`);
      }
      for (const cap of outputs.flatMap((o) => o.result.caps ?? [])) {
        if ((cap.dimension === dim.id || cap.dimension === 'all') && score > cap.max) {
          score = cap.max;
          caps.push(`Capped at ${cap.max.toFixed(1)}: ${cap.reason}`);
        }
      }

      const final = round1(clamp(score, 0, 4));
      return { dimension: dim.id, label: dim.label, score: final, band: Rubric.band(final), rationale, caps, sources };
    });

    const overall = rubric.overall(Object.fromEntries(dimensions.map((d) => [d.dimension, d.score])) as Partial<Record<DimensionId, number>>);
    return { dimensions, overall, band: Rubric.band(overall) };
  }
}

/** Confidence-weighted average of the assessments of one dimension from a group of evaluators. */
function average(outputs: readonly EvaluatorOutput[], dim: DimensionId): { score: number; rationale: string[] } | undefined {
  const parts: DimensionAssessment[] = outputs.flatMap((o) => o.result.assessments.filter((a) => a.dimension === dim));
  if (parts.length === 0) return undefined;
  const weight = parts.reduce((s, a) => s + a.confidence, 0);
  const score = weight > 0 ? parts.reduce((s, a) => s + a.confidence * a.score, 0) / weight : 0;
  return { score: clamp(score, 0, 4), rationale: parts.flatMap((a) => a.rationale) };
}
