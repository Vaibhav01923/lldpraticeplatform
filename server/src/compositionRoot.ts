import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import type { Express } from 'express';
import { EvaluationWorker } from './application/EvaluationWorker';
import { InProcessJobQueue } from './application/JobQueue';
import { PracticeService } from './application/PracticeService';
import type { AppConfig } from './config';
import { Rubric } from './domain/evaluation/Rubric';
import type { Clock, Logger } from './domain/ports';
import { silentLogger, systemClock } from './domain/ports';
import type { ProblemCatalog } from './domain/problem/Problem';
import { AiReviewEvaluator } from './evaluation/ai/AiReviewEvaluator';
import { AnthropicDesignReviewer, type MessagesApi } from './evaluation/ai/AnthropicDesignReviewer';
import { DemoDesignReviewer } from './evaluation/ai/DemoDesignReviewer';
import type { DesignReviewer } from './evaluation/ai/DesignReviewer';
import { DETERMINISTIC_POLICY, EvaluationPipeline, type PipelineSlot } from './evaluation/EvaluationPipeline';
import { RuleBasedEvaluator } from './evaluation/rules/RuleBasedEvaluator';
import { defaultFormats } from './formats';
import type { FormatRegistry } from './formats/SubmissionFormat';
import { createApp } from './http/createApp';
import type { AttemptRepository } from './infrastructure/AttemptRepository';
import { InMemoryAttemptRepository } from './infrastructure/InMemoryAttemptRepository';
import { SqliteAttemptRepository } from './infrastructure/SqliteAttemptRepository';
import { defaultCatalog } from './problems';

export interface ContainerOverrides {
  repository?: AttemptRepository;
  problems?: ProblemCatalog;
  formats?: FormatRegistry;
  /** Replace the configured reviewer; `null` means "no AI at all". */
  reviewer?: DesignReviewer | null;
  clock?: Clock;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
  staticDir?: string;
}

export interface Container {
  app: Express;
  service: PracticeService;
  queue: InProcessJobQueue;
  worker: EvaluationWorker;
  repository: AttemptRepository;
  ai: { enabled: boolean; model?: string };
  /** Re-queue attempts left unfinished by a previous run, and start processing. */
  start(): Promise<{ recovered: number }>;
  /** Stop accepting work, let in-flight evaluations finish, release resources. */
  shutdown(): Promise<void>;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** The one place where concrete classes are chosen and connected. Everything else depends on interfaces. */
export function buildContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const logger = overrides.logger ?? silentLogger;
  const clock = overrides.clock ?? systemClock;

  const repository =
    overrides.repository ?? (config.databasePath === ':memory:' ? new InMemoryAttemptRepository() : new SqliteAttemptRepository(config.databasePath));
  const problems = overrides.problems ?? defaultCatalog();
  const formats = overrides.formats ?? defaultFormats();
  const rubric = Rubric.standard;

  const reviewer = overrides.reviewer !== undefined ? overrides.reviewer : createReviewer(config);
  const slots: PipelineSlot[] = [{ evaluator: new RuleBasedEvaluator(), policy: DETERMINISTIC_POLICY }];
  if (reviewer) {
    slots.push({
      evaluator: new AiReviewEvaluator(reviewer),
      policy: { timeoutMs: config.ai.timeoutMs, maxAttempts: config.ai.maxAttempts, backoffMs: 2_000 },
    });
  }
  const pipeline = new EvaluationPipeline(slots, undefined, { clock, logger, ...(overrides.sleep ? { sleep: overrides.sleep } : {}) });

  const queue = new InProcessJobQueue(config.workerConcurrency, logger);
  const worker = new EvaluationWorker({ attempts: repository, problems, pipeline, rubric, clock, logger });
  const service = new PracticeService({ problems, attempts: repository, formats, queue, aiEnabled: pipeline.hasAi, clock });

  const ai = { enabled: pipeline.hasAi, ...(reviewer ? { model: reviewer.model } : {}) };
  const app = createApp({
    service,
    meta: { aiEnabled: ai.enabled, ...(ai.model ? { aiModel: ai.model } : {}) },
    staticDir: overrides.staticDir ?? join(HERE, '../../web/dist'),
    logger,
  });

  return {
    app,
    service,
    queue,
    worker,
    repository,
    ai,
    async start() {
      queue.start((id) => worker.handle(id));
      const recovered = await worker.recover(queue);
      return { recovered };
    },
    async shutdown() {
      queue.stop();
      await queue.idle();
      if (repository instanceof SqliteAttemptRepository) repository.close();
    },
  };
}

function createReviewer(config: AppConfig): DesignReviewer | null {
  switch (config.ai.provider) {
    case 'anthropic': {
      // The pipeline owns retries and timeouts, so the SDK's own retrying is switched off.
      const client = new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 0 });
      const api: MessagesApi = { create: (body, options) => client.messages.create(body, options) as never };
      return new AnthropicDesignReviewer(api, { model: config.ai.model });
    }
    case 'demo':
      return new DemoDesignReviewer({ mode: config.ai.demoMode });
    default:
      return null;
  }
}
