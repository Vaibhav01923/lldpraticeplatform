import type { Logger } from '../domain/ports';
import { silentLogger } from '../domain/ports';

/** Something that can be asked to evaluate an attempt later. */
export interface JobQueue {
  enqueue(attemptId: string): void;
}

export type JobHandler = (attemptId: string) => Promise<void>;

/**
 * A minimal in-process work queue: FIFO, bounded concurrency, de-duplicated by id.
 *
 * This is the "simple monolith" answer to slow evaluation: submission returns immediately and the learner
 * polls, while a small number of workers drain the queue in the same process. Nothing is lost if the
 * process dies, because the source of truth is the attempt's status in the database, and
 * EvaluationWorker.recover() re-enqueues unfinished attempts on start-up. Swapping this class for
 * a broker (SQS, BullMQ…) changes one adapter and nothing else.
 */
export class InProcessJobQueue implements JobQueue {
  private readonly pending: string[] = [];
  private readonly queued = new Set<string>();
  private readonly active = new Set<string>();
  private handler?: JobHandler;
  private stopped = false;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly concurrency = 2,
    private readonly logger: Logger = silentLogger,
  ) {
    if (concurrency < 1) throw new Error('Concurrency must be at least 1');
  }

  /** Attach the function that processes a job, and begin draining anything already queued. */
  start(handler: JobHandler): void {
    this.handler = handler;
    this.stopped = false;
    this.pump();
  }

  enqueue(attemptId: string): void {
    if (this.stopped || this.queued.has(attemptId) || this.active.has(attemptId)) return;
    this.queued.add(attemptId);
    this.pending.push(attemptId);
    this.pump();
  }

  /** Stop taking new work. In-flight jobs finish (or time out through their own policies). */
  stop(): void {
    this.stopped = true;
  }

  get depth(): number {
    return this.pending.length + this.active.size;
  }

  /** Resolves when nothing is queued or running. Used by tests and graceful shutdown. */
  idle(): Promise<void> {
    if (this.depth === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.handler && !this.stopped && this.active.size < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      this.queued.delete(id);
      this.active.add(id);
      void this.handler(id)
        .catch((error) => this.logger.error('Job handler threw', { attemptId: id, error: String(error) }))
        .finally(() => {
          this.active.delete(id);
          this.pump();
          if (this.depth === 0) this.idleWaiters.splice(0).forEach((r) => r());
        });
    }
    if (this.depth === 0) this.idleWaiters.splice(0).forEach((r) => r());
  }
}
