import type {
  AttemptDto,
  AttemptStatus,
  AttemptSummaryDto,
  DimensionId,
  DraftDto,
  DraftInputDto,
  EvaluationReportDto,
  EvaluationStateDto,
} from '../../../../shared/contracts';
import { InvalidTransitionError, RetryLimitError, StaleDraftError } from '../errors';
import { canTransition } from './AttemptStatus';
import { Submission } from './Submission';

/** Total times the pipeline may be started for one attempt (first run + retries). Bounds AI spend. */
export const MAX_EVALUATION_RUNS = 5;

/** The stored form of an attempt: the client-facing DTO minus view-only fields, plus ownership. */
export type AttemptSnapshot = Omit<AttemptDto, 'problemTitle' | 'aiEnabled'> & { learnerId: string };

export interface StartAttemptParams {
  id: string;
  learnerId: string;
  problemId: string;
  /** 1-based ordinal among this learner's attempts at this problem. */
  number: number;
  now: Date;
  /** Format and starter payload for a fresh attempt. Ignored when `basedOn` is given. */
  formatId: string;
  starterDesign: unknown;
  /** Revise an earlier, submitted attempt: start from what that learner handed in. */
  basedOn?: Attempt;
}

/**
 * One learner's go at one problem, from blank page to feedback.
 *
 * The aggregate root: everything that changes an attempt goes through a method here, and each method
 * enforces the lifecycle (see AttemptStatus). Callers cannot put an attempt into an impossible state,
 * and cannot edit a submission after the fact.
 */
export class Attempt {
  private constructor(private s: AttemptSnapshot) {}

  // ── creation ─────────────────────────────────────────────────────────────

  static start(p: StartAttemptParams): Attempt {
    const draft: DraftDto = p.basedOn
      ? Attempt.draftFromPrevious(p.basedOn)
      : {
          format: p.formatId,
          design: p.starterDesign,
          assumptions: '',
          decisions: '',
          scenarioAnswers: {},
          revision: 0,
        };
    const stamp = p.now.toISOString();
    return new Attempt({
      id: p.id,
      learnerId: p.learnerId,
      problemId: p.problemId,
      number: p.number,
      status: 'DRAFT',
      ...(p.basedOn ? { basedOnAttemptId: p.basedOn.id } : {}),
      draft,
      evaluation: { runsStarted: 0 },
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  static rehydrate(snapshot: AttemptSnapshot): Attempt {
    return new Attempt(structuredClone(snapshot));
  }

  private static draftFromPrevious(prev: Attempt): DraftDto {
    const src = prev.s.submission;
    const from = src
      ? { format: src.format, design: src.design, assumptions: src.assumptions, decisions: src.decisions, scenarioAnswers: src.scenarioAnswers }
      : prev.s.draft;
    return structuredClone({
      format: from.format,
      design: from.design,
      assumptions: from.assumptions,
      decisions: from.decisions,
      scenarioAnswers: from.scenarioAnswers,
      revision: 0,
    });
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.s.id;
  }
  get learnerId(): string {
    return this.s.learnerId;
  }
  get problemId(): string {
    return this.s.problemId;
  }
  get number(): number {
    return this.s.number;
  }
  get status(): AttemptStatus {
    return this.s.status;
  }
  /** True while a worker holds the attempt. Lets callers re-check state that a method call has just changed. */
  get isEvaluating(): boolean {
    return this.s.status === 'EVALUATING';
  }
  get draft(): Readonly<DraftDto> {
    return this.s.draft;
  }
  get report(): EvaluationReportDto | undefined {
    return this.s.report;
  }
  get evaluation(): Readonly<EvaluationStateDto> {
    return this.s.evaluation;
  }
  get updatedAt(): string {
    return this.s.updatedAt;
  }
  get submission(): Submission | undefined {
    return this.s.submission ? Submission.fromDto(this.s.submission) : undefined;
  }

  // ── behaviour ────────────────────────────────────────────────────────────

  /** Autosave. Rejected once submitted, and rejected if it was made against an out-of-date draft. */
  saveDraft(input: DraftInputDto, baseRevision: number, now: Date): void {
    if (this.s.status !== 'DRAFT') {
      throw new InvalidTransitionError('This attempt has been submitted and can no longer be edited. Start a new attempt to revise it.');
    }
    if (baseRevision !== this.s.draft.revision) throw new StaleDraftError(this.s.draft.revision, baseRevision);
    this.s.draft = { ...structuredClone(input), revision: this.s.draft.revision + 1 };
    this.touch(now);
  }

  /** Freeze the learner's work and hand it over for evaluation. */
  submit(submission: Submission, now: Date): void {
    this.transition('SUBMITTED', now);
    this.s.submission = submission.toDto();
    this.s.submittedAt = now.toISOString();
  }

  /** A worker has picked the attempt up. */
  beginEvaluation(now: Date): void {
    this.transition('EVALUATING', now);
    this.s.evaluation = {
      ...this.s.evaluation,
      runsStarted: this.s.evaluation.runsStarted + 1,
      lastStartedAt: now.toISOString(),
    };
    delete this.s.evaluation.lastError;
  }

  /** Early, deterministic-only feedback, shown while slower evaluators are still running. */
  recordProvisionalReport(report: EvaluationReportDto, now: Date): void {
    this.assertStatus('EVALUATING', 'record a provisional report');
    this.s.report = report;
    this.touch(now);
  }

  completeEvaluation(outcome: 'EVALUATED' | 'PARTIALLY_EVALUATED', report: EvaluationReportDto, now: Date): void {
    this.transition(outcome, now);
    this.s.report = report;
    this.s.evaluation = { ...this.s.evaluation, lastFinishedAt: now.toISOString() };
    if (outcome === 'PARTIALLY_EVALUATED') {
      const failed = report.runs.filter((r) => r.status !== 'ok');
      this.s.evaluation.lastError = failed.map((r) => `${r.label}: ${r.error ?? r.status}`).join('; ');
    }
  }

  failEvaluation(error: string, now: Date): void {
    this.transition('EVALUATION_FAILED', now);
    this.s.evaluation = { ...this.s.evaluation, lastError: error, lastFinishedAt: now.toISOString() };
  }

  /**
   * The learner asks for another evaluation after a partial result or a failure.
   * Explicitly limited to those two states: EVALUATING may legally return to SUBMITTED (crash recovery),
   * but a learner must never be able to re-queue an attempt a worker is still running.
   */
  requestRetry(now: Date): void {
    if (this.s.status !== 'PARTIALLY_EVALUATED' && this.s.status !== 'EVALUATION_FAILED') {
      throw new InvalidTransitionError(
        this.s.status === 'EVALUATED'
          ? 'This attempt was fully evaluated, so there is nothing to retry. Start a new attempt to revise it.'
          : `Only a partial or failed evaluation can be retried; this attempt is ${this.s.status}.`,
      );
    }
    if (this.s.evaluation.runsStarted >= MAX_EVALUATION_RUNS) throw new RetryLimitError(MAX_EVALUATION_RUNS);
    this.transition('SUBMITTED', now);
  }

  /** The process stopped mid-evaluation; put the attempt back in the queue. Only valid for an in-flight evaluation. */
  requeueInterrupted(now: Date): void {
    this.assertStatus('EVALUATING', 'requeue an interrupted evaluation');
    this.transition('SUBMITTED', now);
  }

  // ── views ────────────────────────────────────────────────────────────────

  toSnapshot(): AttemptSnapshot {
    return structuredClone(this.s);
  }

  toDto(problemTitle: string, aiEnabled: boolean): AttemptDto {
    const { learnerId: _owner, ...rest } = this.toSnapshot();
    return { ...rest, problemTitle, aiEnabled };
  }

  summary(problemTitle: string): AttemptSummaryDto {
    const report = this.s.report;
    const scoreable = report && !report.provisional ? report : undefined;
    return {
      id: this.s.id,
      problemId: this.s.problemId,
      problemTitle,
      number: this.s.number,
      status: this.s.status,
      ...(scoreable
        ? {
            overall: scoreable.overall,
            band: scoreable.band,
            complete: scoreable.complete,
            dimensionScores: Object.fromEntries(scoreable.dimensions.map((d) => [d.dimension, d.score])) as Partial<Record<DimensionId, number>>,
          }
        : {}),
      createdAt: this.s.createdAt,
      ...(this.s.submittedAt ? { submittedAt: this.s.submittedAt } : {}),
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private transition(to: AttemptStatus, now: Date): void {
    if (!canTransition(this.s.status, to)) {
      throw new InvalidTransitionError(`An attempt that is ${this.s.status} cannot become ${to}.`);
    }
    this.s.status = to;
    this.touch(now);
  }

  private assertStatus(expected: AttemptStatus, action: string): void {
    if (this.s.status !== expected) {
      throw new InvalidTransitionError(`Cannot ${action} while the attempt is ${this.s.status}.`);
    }
  }

  private touch(now: Date): void {
    this.s.updatedAt = now.toISOString();
  }
}
