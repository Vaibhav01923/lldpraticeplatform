import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('has safe defaults and no AI without a key', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ port: 3000, databasePath: 'data/lld.db', workerConcurrency: 2, ai: { provider: 'off', model: 'claude-opus-5', timeoutMs: 120_000, maxAttempts: 2 } });
  });

  it('turns AI on automatically when a key is present, and treats blank variables as unset', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: 'sk-test' }).ai.provider).toBe('anthropic');
    expect(loadConfig({ ANTHROPIC_API_KEY: '', PORT: '' }).ai.provider).toBe('off');
    expect(loadConfig({ ANTHROPIC_API_KEY: '', PORT: '' }).port).toBe(3000);
  });

  it('supports the keyless demo reviewer and an explicit off switch', () => {
    expect(loadConfig({ LLD_AI_PROVIDER: 'demo', LLD_DEMO_MODE: 'flaky' }).ai).toMatchObject({ provider: 'demo', demoMode: 'flaky' });
    expect(loadConfig({ ANTHROPIC_API_KEY: 'sk-test', LLD_AI_PROVIDER: 'off' }).ai.provider).toBe('off');
  });

  it('fails fast on inconsistent or invalid settings', () => {
    expect(() => loadConfig({ LLD_AI_PROVIDER: 'anthropic' })).toThrow(/needs ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ LLD_AI_MAX_ATTEMPTS: '99' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ LLD_DEMO_MODE: 'chaos' })).toThrow(/Invalid configuration/);
  });
});
