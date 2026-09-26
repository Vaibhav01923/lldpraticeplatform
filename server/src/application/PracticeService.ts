import type {
  ApproachDto,
  AttemptDto,
  AttemptSummaryDto,
  DraftInputDto,
  FormatInfoDto,
  PreflightDto,
  ProblemDto,
  ProblemListItemDto,
  ProgressDto,
} from '../../../shared/contracts';
import { Attempt } from '../domain/attempt/Attempt';
import { hasFeedback } from '../domain/attempt/AttemptStatus';
import { Submission } from '../domain/attempt/Submission';
import { InvalidTransitionError, NotFoundError, PolicyError, ValidationError } from '../domain/errors';
import type { Problem, ProblemCatalog } from '../domain/problem/Problem';
import type { Clock, IdGenerator } from '../domain/ports';
import { systemClock, uuidGenerator } from '../domain/ports';
import type { FormatRegistry } from '../formats/SubmissionFormat';
import { DuplicateAttemptNumberError, type AttemptRepository } from '../infrastructure/AttemptRepository';
import { compareAttempts, type ComparableAttempt } from './AttemptComparison';
import type { JobQueue } from './JobQueue';

export interface PracticeServiceDeps {
  problems: ProblemCatalog;
  attempts: AttemptRepository;
  formats: FormatRegistry;
  queue: JobQueue;
  /** Whether an AI reviewer is configured. Reported to clients so the UI can explain what feedback to expect. */
  aiEnabled: boolean;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * The learner-facing use cases. Every method takes the learner's id and can only see that learner's attempts,
 * so ownership is enforced in one place rather than in each route.
 */
export class PracticeService {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(private readonly deps: PracticeServiceDeps) {
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? uuidGenerator;
  }

  // ── catalogue ────────────────────────────────────────────────────────────

  async listProblems(learnerId?: string): Promise<ProblemListItemDto[]> {
    const mine = learnerId ? await this.deps.attempts.listByLearner(learnerId) : [];
    return this.deps.problems.list().map((p) => {
      const attempts = mine.filter((a) => a.problemId === p.id);
      const scored = attempts.map((a) => a.summary(p.title)).filter((s) => s.overall !== undefined);
      const latest = scored.sort((a, b) => b.number - a.number)[0];
      const draft = attempts.find((a) => a.status === 'DRAFT');
      return {
        ...p.toSummary(),
        attemptCount: attempts.length,
        ...(scored.length ? { bestScore: Math.max(...scored.map((s) => s.overall!)) } : {}),
        ...(latest ? { latestScore: latest.overall!, latestBand: latest.band! } : {}),
        ...(draft ? { openDraftId: draft.id } : {}),
      };
    });
  }

  getProblem(problemId: string): ProblemDto {
    return this.requireProblem(problemId).toDto();
  }

  formats(): FormatInfoDto[] {
    return this.deps.formats.list();
  }

  /** Known-valid approaches are a reward for trying, not a shortcut: available only after a first submission. */
  async approaches(learnerId: string, problemId: string): Promise<ApproachDto[]> {
    const problem = this.requireProblem(problemId);
    const mine = await this.deps.attempts.listByLearner(learnerId, { problemId });
    if (!mine.some((a) => a.status !== 'DRAFT')) {
      throw new PolicyError('Common approaches unlock once you have submitted an attempt. Try it first: you will learn more from comparing.');
    }
    return problem.approaches.map((a) => ({ ...a }));
  }

  // ── attempts ─────────────────────────────────────────────────────────────

  /**
   * Begin an attempt. With no `basedOn`, resumes the learner's open draft for the problem if there is one.
   * With `basedOn`, starts a revision pre-filled from that submitted attempt.
   */
  async startAttempt(learnerId: string, problemId: string, basedOnAttemptId?: string): Promise<{ attempt: AttemptDto; resumed: boolean }> {
    const problem = this.requireProblem(problemId);
    const existing = await this.deps.attempts.findOpenDraft(learnerId, problemId);

    let basedOn: Attempt | undefined;
    if (basedOnAttemptId) {
      basedOn = await this.requireOwned(learnerId, basedOnAttemptId);
      if (basedOn.problemId !== problemId) throw new ValidationError('That attempt belongs to a different problem.');
      if (!basedOn.submission) throw new InvalidTransitionError('Only a submitted attempt can be revised.');
      if (existing) throw new InvalidTransitionError(`You already have a draft in progress for this problem (attempt #${existing.number}). Submit or discard it first.`);
    } else if (existing) {
      return { attempt: this.view(existing, problem), resumed: true };
    }

    const formatId = basedOn ? undefined : this.deps.formats.defaultId;
    for (let tries = 0; ; tries++) {
      const number = (await this.deps.attempts.highestNumber(learnerId, problemId)) + 1;
      const attempt = Attempt.start({
        id: this.ids.next(),
        learnerId,
        problemId,
        number,
        now: this.clock.now(),
        formatId: formatId ?? '',
        starterDesign: formatId ? this.deps.formats.get(formatId).starter() : undefined,
        basedOn,
      });
      try {
        await this.deps.attempts.save(attempt);
        return { attempt: this.view(attempt, problem), resumed: false };
      } catch (error) {
        // Two starts raced for the same number; take the next one.
        if (error instanceof DuplicateAttemptNumberError && tries < 3) continue;
        throw error;
      }
    }
  }

  async getAttempt(learnerId: string, attemptId: string): Promise<AttemptDto> {
    const attempt = await this.requireOwned(learnerId, attemptId);
    return this.view(attempt, this.requireProblem(attempt.problemId));
  }

  async listAttempts(learnerId: string, problemId?: string): Promise<AttemptSummaryDto[]> {
    const attempts = await this.deps.attempts.listByLearner(learnerId, problemId ? { problemId } : {});
    return attempts.map((a) => a.summary(this.deps.problems.get(a.problemId)?.title ?? a.problemId));
  }

  async saveDraft(learnerId: string, attemptId: string, input: DraftInputDto, baseRevision: number): Promise<AttemptDto> {
    const attempt = await this.requireOwned(learnerId, attemptId);
    this.deps.formats.get(input.format); // unknown format → 422 before we store anything
    attempt.saveDraft(input, baseRevision, this.clock.now());
    await this.deps.attempts.save(attempt);
    return this.view(attempt, this.requireProblem(attempt.problemId));
  }

  async discardDraft(learnerId: string, attemptId: string): Promise<void> {
    const attempt = await this.requireOwned(learnerId, attemptId);
    if (attempt.status !== 'DRAFT') throw new InvalidTransitionError('Only a draft can be discarded. Submitted attempts are part of your history.');
    await this.deps.attempts.delete(attempt.id);
  }

  /** Check a design without submitting it: parse errors, warnings and a quick summary. Stateless. */
  preflight(formatId: string, design: unknown): PreflightDto {
    const { model, issues } = this.deps.formats.get(formatId).parse(design);
    if (!model) return { ok: false, issues };
    const classes = model.classes;
    return {
      ok: true,
      issues,
      model: model.toDto(),
      stats: {
        classes: classes.length,
        relationships: model.relationships.length,
        withResponsibility: classes.filter((c) => c.hasResponsibility).length,
        abstractions: classes.filter((c) => c.isAbstraction).length,
      },
    };
  }

  /** Freeze the draft, and queue it for evaluation. Returns immediately; the learner polls for the result. */
  async submit(learnerId: string, attemptId: string): Promise<AttemptDto> {
    const attempt = await this.requireOwned(learnerId, attemptId);
    const problem = this.requireProblem(attempt.problemId);
    if (attempt.status !== 'DRAFT') throw new InvalidTransitionError('This attempt has already been submitted.');

    const draft = attempt.draft;
    const { model, issues } = this.deps.formats.get(draft.format).parse(draft.design);
    if (!model) {
      throw new ValidationError('Your design cannot be submitted yet. Fix these first:', issues.filter((i) => i.severity === 'error'));
    }

    const known = new Set(problem.scenarios.map((s) => s.id));
    const scenarioAnswers = Object.fromEntries(Object.entries(draft.scenarioAnswers).filter(([id]) => known.has(id)));
    const now = this.clock.now();
    attempt.submit(new Submission(draft.format, draft.design, model, draft.assumptions, draft.decisions, scenarioAnswers, now), now);
    await this.deps.attempts.save(attempt);
    this.deps.queue.enqueue(attempt.id);
    return this.view(attempt, problem);
  }

  /** After a partial result or a failure, run the evaluation again. */
  async retryEvaluation(learnerId: string, attemptId: string): Promise<AttemptDto> {
    const attempt = await this.requireOwned(learnerId, attemptId);
    attempt.requestRetry(this.clock.now());
    await this.deps.attempts.save(attempt);
    this.deps.queue.enqueue(attempt.id);
    return this.view(attempt, this.requireProblem(attempt.problemId));
  }

  // ── progress ─────────────────────────────────────────────────────────────

  async progress(learnerId: string, problemId: string): Promise<ProgressDto> {
    const problem = this.requireProblem(problemId);
    const mine = (await this.deps.attempts.listByLearner(learnerId, { problemId })).sort((a, b) => a.number - b.number);
    const withFeedback: ComparableAttempt[] = mine
      .filter((a) => hasFeedback(a.status) && a.report && !a.report.provisional)
      .map((a) => ({ id: a.id, number: a.number, report: a.report! }));
    const [from, to] = withFeedback.slice(-2);
    return {
      problemId,
      attempts: mine.map((a) => a.summary(problem.title)),
      ...(from && to ? { comparison: compareAttempts(from, to) } : {}),
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private requireProblem(id: string): Problem {
    const p = this.deps.problems.get(id);
    if (!p) throw new NotFoundError('Problem', id);
    return p;
  }

  /** Someone else's attempt is reported as not found, not forbidden, so ids cannot be probed. */
  private async requireOwned(learnerId: string, attemptId: string): Promise<Attempt> {
    const attempt = await this.deps.attempts.findById(attemptId);
    if (!attempt || attempt.learnerId !== learnerId) throw new NotFoundError('Attempt', attemptId);
    return attempt;
  }

  private view(attempt: Attempt, problem: Problem): AttemptDto {
    return attempt.toDto(problem.title, this.deps.aiEnabled);
  }
}
