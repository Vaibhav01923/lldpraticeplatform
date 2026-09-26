import { buildContainer, type Container, type ContainerOverrides } from '../../src/compositionRoot';
import type { AppConfig } from '../../src/config';
import type { DesignReviewer } from '../../src/evaluation/ai/DesignReviewer';
import { DemoDesignReviewer } from '../../src/evaluation/ai/DemoDesignReviewer';
import { TransientEvaluatorError } from '../../src/evaluation/Evaluator';
import type { RawReview } from '../../src/evaluation/ai/reviewSchema';

export const LEARNER = 'learner-aaaa1111';
export const OTHER_LEARNER = 'learner-bbbb2222';

export const testConfig: AppConfig = {
  port: 0,
  databasePath: ':memory:',
  ai: { provider: 'off', model: 'test-model', demoMode: 'ok', timeoutMs: 1_000, maxAttempts: 2 },
  workerConcurrency: 2,
};

/** A container with an in-memory database, no waiting on backoff, and (by default) no AI. */
export function testContainer(overrides: ContainerOverrides = {}): Container {
  return buildContainer(testConfig, { reviewer: null, sleep: async () => {}, ...overrides });
}

/** A reviewer that fails its first `failures` calls with a transient error, then behaves like the demo reviewer. */
export function flakyReviewer(failures: number): DesignReviewer & { calls: number } {
  const inner = new DemoDesignReviewer({ latencyMs: 0 });
  const r = {
    model: 'scripted-reviewer',
    calls: 0,
    async review(input: Parameters<DesignReviewer['review']>[0], signal: AbortSignal): Promise<RawReview> {
      r.calls++;
      if (r.calls <= failures) throw new TransientEvaluatorError('upstream unavailable');
      return inner.review(input, signal);
    },
  };
  return r;
}

export const goodReviewer = (): DesignReviewer => new DemoDesignReviewer({ latencyMs: 0 });
