import type { EvaluationReportDto, EvaluatorRunDto } from '../../../shared/contracts';
import type { Clock, Logger } from '../domain/ports';
import { silentLogger, systemClock } from '../domain/ports';
import { isTransient, PermanentEvaluatorError, TransientEvaluatorError, type EvaluationContext, type Evaluator } from './Evaluator';
import { ReportAssembler } from './ReportAssembler';
import type { EvaluatorOutput } from './ScoreAggregator';

export interface EvaluatorPolicy {
  /** Time budget for one try. The evaluator's AbortSignal fires when it is spent. */
  timeoutMs: number;
  /** Tries in total, including the first. Only transient failures and timeouts are retried. */
  maxAttempts: number;
  /** Delay before the second try; doubles each time. */
  backoffMs: number;
}

export const DETERMINISTIC_POLICY: EvaluatorPolicy = { timeoutMs: 5_000, maxAttempts: 1, backoffMs: 0 };

export interface PipelineSlot {
  evaluator: Evaluator;
  policy: EvaluatorPolicy;
}

export interface PipelineOutcome {
  status: 'EVALUATED' | 'PARTIALLY_EVALUATED' | 'EVALUATION_FAILED';
  report?: EvaluationReportDto;
  error?: string;
}

export interface PipelineHooks {
  /** Called with a deterministic-only report as soon as it exists, while slower evaluators run. Best effort. */
  onProvisional?: (report: EvaluationReportDto) => Promise<void> | void;
}

export interface PipelineDeps {
  clock?: Clock;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs the configured evaluators over one submission and always returns something honest.
 *
 * - Stage 1 (deterministic evaluators) is fast and cannot depend on the network, so it runs first and its
 *   report is published immediately as provisional feedback.
 * - Stage 2 (AI evaluators) sees stage 1's findings. Each evaluator has its own time budget and retry policy,
 *   and a failure in one never discards the results of another.
 * - Outcome: every evaluator ok → EVALUATED; some failed → PARTIALLY_EVALUATED with the feedback that exists;
 *   none succeeded → EVALUATION_FAILED.
 */
export class EvaluationPipeline {
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly slots: readonly PipelineSlot[],
    private readonly assembler: ReportAssembler = new ReportAssembler(),
    deps: PipelineDeps = {},
  ) {
    if (slots.length === 0) throw new Error('A pipeline needs at least one evaluator');
    this.clock = deps.clock ?? systemClock;
    this.logger = deps.logger ?? silentLogger;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Whether any evaluator is backed by a model. */
  get hasAi(): boolean {
    return this.slots.some((s) => s.evaluator.kind === 'ai');
  }

  async run(base: Omit<EvaluationContext, 'priorFindings'>, hooks: PipelineHooks = {}): Promise<PipelineOutcome> {
    const deterministic = this.slots.filter((s) => s.evaluator.kind === 'deterministic');
    const ai = this.slots.filter((s) => s.evaluator.kind === 'ai');
    const runs: EvaluatorRunDto[] = [];
    const outputs: EvaluatorOutput[] = [];

    const collect = (settled: SlotResult[]) => {
      for (const s of settled) {
        runs.push(s.run);
        if (s.output) outputs.push(s.output);
      }
    };

    // Stage 1
    collect(await Promise.all(deterministic.map((slot) => this.runSlot(slot, { ...base, priorFindings: [] }))));

    // Provisional feedback, if a slower stage is still to come
    if (ai.length > 0 && outputs.length > 0 && hooks.onProvisional) {
      try {
        await hooks.onProvisional(this.assemble(base, outputs, runs, true));
      } catch (error) {
        this.logger.warn('Could not publish provisional report', { error: String(error) });
      }
    }

    // Stage 2
    const priorFindings = outputs.flatMap((o) => o.result.findings);
    collect(await Promise.all(ai.map((slot) => this.runSlot(slot, { ...base, priorFindings }))));

    if (outputs.length === 0) {
      return { status: 'EVALUATION_FAILED', error: runs.map((r) => `${r.label}: ${r.error ?? r.status}`).join('; ') };
    }
    const report = this.assemble(base, outputs, runs, false);
    return { status: report.complete ? 'EVALUATED' : 'PARTIALLY_EVALUATED', report };
  }

  private assemble(base: Omit<EvaluationContext, 'priorFindings'>, outputs: EvaluatorOutput[], runs: EvaluatorRunDto[], provisional: boolean): EvaluationReportDto {
    return this.assembler.assemble({
      rubric: base.rubric,
      outputs,
      runs,
      provisional,
      expectedEvaluators: this.slots.length,
      now: this.clock.now(),
    });
  }

  private async runSlot(slot: PipelineSlot, ctx: EvaluationContext): Promise<SlotResult> {
    const { evaluator, policy } = slot;
    const started = this.clock.now().getTime();
    const describe = (attempts: number, status: EvaluatorRunDto['status'], error?: string): EvaluatorRunDto => ({
      evaluatorId: evaluator.id,
      kind: evaluator.kind,
      label: evaluator.label,
      status,
      durationMs: this.clock.now().getTime() - started,
      attempts,
      ...(error ? { error } : {}),
      ...(evaluator.model ? { model: evaluator.model } : {}),
    });

    for (let attempt = 1; ; attempt++) {
      let timedOut = false;
      try {
        const result = await this.withTimeout(evaluator, ctx, policy.timeoutMs, () => (timedOut = true));
        return { run: describe(attempt, 'ok'), output: { evaluator, result } };
      } catch (error) {
        const retryable = timedOut || isTransient(error);
        const status = timedOut ? 'timed_out' : 'failed';
        this.logger.warn(`Evaluator '${evaluator.id}' ${status} (attempt ${attempt}/${policy.maxAttempts})`, { error: String(error) });
        if (retryable && attempt < policy.maxAttempts) {
          await this.sleep(policy.backoffMs * 2 ** (attempt - 1));
          continue;
        }
        return { run: describe(attempt, status, timedOut ? `Did not finish within ${Math.round(policy.timeoutMs / 1000)}s.` : learnerSafeMessage(error)) };
      }
    }
  }

  /** Races the evaluator against its time budget, so a hung or signal-ignoring evaluator cannot stall the pipeline. */
  private async withTimeout<T extends object>(evaluator: Evaluator, ctx: EvaluationContext, timeoutMs: number, onTimeout: () => void) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        controller.abort();
        reject(new Error('timed out'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([evaluator.evaluate(ctx, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

interface SlotResult {
  run: EvaluatorRunDto;
  output?: EvaluatorOutput;
}

/** Evaluator errors we wrote are safe to show; anything else could carry internals, so it is generalised. */
function learnerSafeMessage(error: unknown): string {
  if (error instanceof TransientEvaluatorError || error instanceof PermanentEvaluatorError) return error.message;
  return 'An unexpected error occurred while running this check.';
}
