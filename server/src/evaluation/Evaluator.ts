import type {
  AlternativeNoteDto,
  CapabilityCoverageDto,
  DimensionId,
  FindingDto,
} from '../../../shared/contracts';
import type { Submission } from '../domain/attempt/Submission';
import type { Rubric } from '../domain/evaluation/Rubric';
import type { Problem } from '../domain/problem/Problem';

export interface EvaluationContext {
  problem: Problem;
  submission: Submission;
  rubric: Rubric;
  /**
   * Findings produced by the deterministic stage. Empty for the deterministic evaluators themselves;
   * populated for AI evaluators so they can build on, and where warranted dispute, what the rules found.
   */
  priorFindings: readonly FindingDto[];
}

/** One evaluator's view of one rubric dimension. */
export interface DimensionAssessment {
  dimension: DimensionId;
  /** 0–4. */
  score: number;
  /** 0–1: how much weight this assessment deserves relative to other evaluators'. */
  confidence: number;
  /** Plain-language reasons, shown to the learner. */
  rationale: string[];
}

/** A guardrail: whatever else is said, this dimension cannot score above `max`. */
export interface ScoreCap {
  dimension: DimensionId | 'all';
  max: number;
  reason: string;
}

/** The AI reviewer's claim that a rule finding does not apply to this particular design. */
export interface Dispute {
  findingId: string;
  reason: string;
}

export interface EvaluatorResult {
  assessments: DimensionAssessment[];
  findings: FindingDto[];
  caps?: ScoreCap[];
  coverage?: CapabilityCoverageDto[];
  alternatives?: AlternativeNoteDto[];
  disputes?: Dispute[];
  summary?: string;
  reflectionQuestions?: string[];
}

/**
 * One way of judging a submission. The pipeline knows only this interface, so adding another approach
 * (a test-running evaluator for code submissions, a peer-review evaluator, a different LLM) means writing one
 * class and registering it: nothing else changes.
 */
export interface Evaluator {
  readonly id: string;
  readonly label: string;
  readonly kind: 'deterministic' | 'ai';
  /** Model name, when the evaluator is backed by one. Reported so learners know what judged them. */
  readonly model?: string;
  /** Must honour `signal`: it fires when the pipeline's time budget for this evaluator is spent. */
  evaluate(ctx: EvaluationContext, signal: AbortSignal): Promise<EvaluatorResult>;
}

/** A failure that is worth retrying (rate limit, network blip, overloaded upstream, malformed reply). */
export class TransientEvaluatorError extends Error {
  readonly transient = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientEvaluatorError';
  }
}

/** A failure retrying will not fix (bad credentials, refused request, bug). */
export class PermanentEvaluatorError extends Error {
  readonly transient = false;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentEvaluatorError';
  }
}

export function isTransient(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { transient?: unknown }).transient === true;
}
