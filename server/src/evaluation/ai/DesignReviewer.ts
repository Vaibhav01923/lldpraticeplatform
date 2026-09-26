import type { FindingDto } from '../../../../shared/contracts';
import type { Submission } from '../../domain/attempt/Submission';
import type { Rubric } from '../../domain/evaluation/Rubric';
import type { Problem } from '../../domain/problem/Problem';
import type { RawReview } from './reviewSchema';

export interface ReviewInput {
  problem: Problem;
  submission: Submission;
  rubric: Rubric;
  /** What the deterministic stage already found, so the reviewer adds insight instead of repeating it. */
  ruleFindings: readonly FindingDto[];
}

/**
 * The seam between "evaluate a design" and "which model does it". An adapter turns a ReviewInput into a
 * model call and returns the model's *untrusted* answer; validation and safety live in the AiReviewEvaluator
 * so they apply equally to every adapter (Anthropic, another vendor, a local model, the demo reviewer).
 */
export interface DesignReviewer {
  readonly model: string;
  review(input: ReviewInput, signal: AbortSignal): Promise<RawReview>;
}
