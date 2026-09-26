import { z } from 'zod';

const blankIsUnset = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const EnvSchema = z.object({
  PORT: z.preprocess(blankIsUnset, z.coerce.number().int().min(0).max(65535).default(3000)),
  DATABASE_PATH: z.preprocess(blankIsUnset, z.string().default('data/lld.db')),
  ANTHROPIC_API_KEY: z.preprocess(blankIsUnset, z.string().optional()),
  /** auto: use Claude if a key is present, else no AI. off: never. demo: built-in stand-in (no key needed). */
  LLD_AI_PROVIDER: z.preprocess(blankIsUnset, z.enum(['auto', 'anthropic', 'demo', 'off']).default('auto')),
  LLD_AI_MODEL: z.preprocess(blankIsUnset, z.string().default('claude-opus-5')),
  LLD_DEMO_MODE: z.preprocess(blankIsUnset, z.enum(['ok', 'slow', 'fail', 'flaky', 'garbage']).default('ok')),
  LLD_AI_TIMEOUT_MS: z.preprocess(blankIsUnset, z.coerce.number().int().positive().default(120_000)),
  LLD_AI_MAX_ATTEMPTS: z.preprocess(blankIsUnset, z.coerce.number().int().min(1).max(5).default(2)),
  LLD_WORKER_CONCURRENCY: z.preprocess(blankIsUnset, z.coerce.number().int().min(1).max(16).default(2)),
});

export interface AppConfig {
  port: number;
  databasePath: string;
  ai: {
    provider: 'anthropic' | 'demo' | 'off';
    apiKey?: string;
    model: string;
    demoMode: 'ok' | 'slow' | 'fail' | 'flaky' | 'garbage';
    timeoutMs: number;
    maxAttempts: number;
  };
  workerConcurrency: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;

  let provider: AppConfig['ai']['provider'];
  if (e.LLD_AI_PROVIDER === 'auto') provider = e.ANTHROPIC_API_KEY ? 'anthropic' : 'off';
  else provider = e.LLD_AI_PROVIDER;
  if (provider === 'anthropic' && !e.ANTHROPIC_API_KEY) {
    throw new Error('LLD_AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY to be set.');
  }

  return {
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    ai: {
      provider,
      ...(e.ANTHROPIC_API_KEY ? { apiKey: e.ANTHROPIC_API_KEY } : {}),
      model: e.LLD_AI_MODEL,
      demoMode: e.LLD_DEMO_MODE,
      timeoutMs: e.LLD_AI_TIMEOUT_MS,
      maxAttempts: e.LLD_AI_MAX_ATTEMPTS,
    },
    workerConcurrency: e.LLD_WORKER_CONCURRENCY,
  };
}
