import { TransientEvaluatorError, type EvaluationContext, type Evaluator, type EvaluatorResult } from '../Evaluator';
import type { DesignReviewer } from './DesignReviewer';
import { RawReviewSchema } from './reviewSchema';
import { sanitizeReview } from './ReviewSanitizer';

/**
 * Adds the judgement rules cannot: whether responsibilities are cohesive, whether relationships make sense,
 * whether the learner's change-scenario answers hold up, whether their trade-offs are sound.
 *
 * It trusts nothing it is given by the model: the reply is schema-validated, then sanitised against the
 * learner's actual design (see ReviewSanitizer). A malformed or empty reply counts as a transient failure, so
 * the pipeline's retry policy handles it like any other flaky upstream.
 */
export class AiReviewEvaluator implements Evaluator {
  readonly id = 'ai-review';
  readonly label = 'AI design review';
  readonly kind = 'ai' as const;

  constructor(private readonly reviewer: DesignReviewer) {}

  get model(): string {
    return this.reviewer.model;
  }

  async evaluate(ctx: EvaluationContext, signal: AbortSignal): Promise<EvaluatorResult> {
    const raw = await this.reviewer.review(
      { problem: ctx.problem, submission: ctx.submission, rubric: ctx.rubric, ruleFindings: ctx.priorFindings },
      signal,
    );
    const parsed = RawReviewSchema.safeParse(raw);
    if (!parsed.success) throw new TransientEvaluatorError('The AI reviewer returned a reply in the wrong format.');

    const result = sanitizeReview(parsed.data, { model: ctx.submission.model, ruleFindings: ctx.priorFindings });
    if (result.assessments.length === 0 && result.findings.length === 0) {
      throw new TransientEvaluatorError('The AI reviewer returned an empty review.');
    }
    return result;
  }
}
