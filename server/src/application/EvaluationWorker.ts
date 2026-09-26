import { MAX_EVALUATION_RUNS } from '../domain/attempt/Attempt';
import type { Rubric } from '../domain/evaluation/Rubric';
import type { ProblemCatalog } from '../domain/problem/Problem';
import type { Clock, Logger } from '../domain/ports';
import { silentLogger, systemClock } from '../domain/ports';
import type { EvaluationPipeline } from '../evaluation/EvaluationPipeline';
import type { AttemptRepository } from '../infrastructure/AttemptRepository';
import type { JobQueue } from './JobQueue';

export interface EvaluationWorkerDeps {
  attempts: AttemptRepository;
  problems: ProblemCatalog;
  pipeline: EvaluationPipeline;
  rubric: Rubric;
  clock?: Clock;
  logger?: Logger;
}

/**
 * Takes one submitted attempt through evaluation and records the outcome.
 *
 * Two properties matter more than the happy path:
 *  - It is idempotent: an attempt that is not SUBMITTED (already picked up, finished, or deleted) is skipped,
 *    so duplicate queue entries and restarts are harmless.
 *  - It never leaves an attempt stuck in EVALUATING: any unexpected error is caught and recorded as a
 *    failure the learner can retry.
 */
export class EvaluationWorker {
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(private readonly deps: EvaluationWorkerDeps) {
    this.clock = deps.clock ?? systemClock;
    this.logger = deps.logger ?? silentLogger;
  }

  async handle(attemptId: string): Promise<void> {
    const { attempts, problems, pipeline, rubric } = this.deps;
    const attempt = await attempts.findById(attemptId);
    if (!attempt) return this.logger.warn('Skipping unknown attempt', { attemptId });
    if (attempt.status !== 'SUBMITTED') return this.logger.info('Skipping attempt that is not awaiting evaluation', { attemptId, status: attempt.status });

    attempt.beginEvaluation(this.clock.now());
    await attempts.save(attempt);

    try {
      const problem = problems.get(attempt.problemId);
      const submission = attempt.submission;
      if (!problem || !submission) throw new Error(`Attempt ${attemptId} refers to a missing problem or submission`);

      const outcome = await pipeline.run(
        { problem, submission, rubric },
        {
          onProvisional: async (report) => {
            attempt.recordProvisionalReport(report, this.clock.now());
            await attempts.save(attempt);
          },
        },
      );

      if (outcome.status === 'EVALUATION_FAILED') attempt.failEvaluation(outcome.error ?? 'Evaluation failed.', this.clock.now());
      else attempt.completeEvaluation(outcome.status, outcome.report!, this.clock.now());
    } catch (error) {
      this.logger.error('Evaluation crashed', { attemptId, error: String(error) });
      // Only reachable if the attempt is still EVALUATING; guard so a second failure cannot mask the first.
      if (attempt.isEvaluating) attempt.failEvaluation('Evaluation could not be completed. You can try again.', this.clock.now());
    }
    await attempts.save(attempt);
  }

  /**
   * Start-up recovery. Attempts left SUBMITTED never reached a worker; attempts left EVALUATING were interrupted
   * by a stop or crash. Both are put back in the queue, unless an attempt has already burnt its evaluation budget
   * (which stops a poison submission from crash-looping the process).
   */
  async recover(queue: JobQueue): Promise<number> {
    const stuck = await this.deps.attempts.findByStatus(['SUBMITTED', 'EVALUATING']);
    for (const attempt of stuck) {
      if (attempt.status === 'EVALUATING') {
        if (attempt.evaluation.runsStarted >= MAX_EVALUATION_RUNS) {
          attempt.failEvaluation('Evaluation was interrupted too many times.', this.clock.now());
          await this.deps.attempts.save(attempt);
          continue;
        }
        attempt.requeueInterrupted(this.clock.now());
        await this.deps.attempts.save(attempt);
      }
      queue.enqueue(attempt.id);
    }
    return stuck.length;
  }
}
