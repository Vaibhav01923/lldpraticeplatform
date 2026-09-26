import { describe, it, expect, vi } from 'vitest';
import { EvaluationPipeline, DETERMINISTIC_POLICY, type EvaluatorPolicy } from '../../src/evaluation/EvaluationPipeline';
import { PermanentEvaluatorError, TransientEvaluatorError } from '../../src/evaluation/Evaluator';
import { Rubric } from '../../src/domain/evaluation/Rubric';
import { parkingLot } from '../../src/problems/parkingLot';
import { assessAll, fakeEvaluator, result, ruleFinding } from '../helpers/evaluators';
import { crcSubmission } from '../helpers/fixtures';

const base = () => ({ problem: parkingLot, submission: crcSubmission(), rubric: Rubric.standard });
const fastAi: EvaluatorPolicy = { timeoutMs: 1_000, maxAttempts: 3, backoffMs: 100 };
const instantSleep = () => vi.fn(async (_ms: number) => {});

const det = (findings = [ruleFinding({ id: 'r1' })]) => fakeEvaluator('deterministic', () => result({ findings, assessments: assessAll(2) }));
const pipeline = (slots: ConstructorParameters<typeof EvaluationPipeline>[0], sleep = instantSleep()) => ({ p: new EvaluationPipeline(slots, undefined, { sleep }), sleep });

describe('EvaluationPipeline', () => {
  it('completes as EVALUATED when every evaluator succeeds, and hands deterministic findings to the AI stage', async () => {
    const d = det();
    const a = fakeEvaluator('ai', () => result({ assessments: assessAll(3) }));
    const { p } = pipeline([{ evaluator: d, policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: fastAi }]);
    const out = await p.run(base());
    expect(out.status).toBe('EVALUATED');
    expect(out.report!.complete).toBe(true);
    expect(out.report!.runs.map((r) => [r.evaluatorId, r.status])).toEqual([['fake-rules', 'ok'], ['fake-ai', 'ok']]);
    expect(a.seenContexts[0]!.priorFindings.map((f) => f.id)).toEqual(['r1']);
    expect(d.seenContexts[0]!.priorFindings).toEqual([]);
  });

  it('works with deterministic evaluators only (no AI configured)', async () => {
    const { p } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }]);
    expect(p.hasAi).toBe(false);
    const out = await p.run(base());
    expect(out.status).toBe('EVALUATED');
  });

  it('publishes a provisional report before the slow stage finishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = fakeEvaluator('ai', async () => { await gate; return result(); });
    const { p } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: fastAi }]);
    const provisional: boolean[] = [];
    const running = p.run(base(), { onProvisional: (r) => { provisional.push(r.provisional); release(); } });
    const out = await running;
    expect(provisional).toEqual([true]);
    expect(out.report!.provisional).toBe(false);
  });

  it('survives a failing provisional hook', async () => {
    const { p } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }, { evaluator: fakeEvaluator('ai', () => result()), policy: fastAi }]);
    const out = await p.run(base(), { onProvisional: () => { throw new Error('db down'); } });
    expect(out.status).toBe('EVALUATED');
  });

  describe('when the AI stage misbehaves', () => {
    it('retries transient failures with exponential backoff, then succeeds', async () => {
      const a = fakeEvaluator('ai', (_c, _s, call) => { if (call < 3) throw new TransientEvaluatorError('rate limited'); return result(); });
      const { p, sleep } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: fastAi }]);
      const out = await p.run(base());
      expect(out.status).toBe('EVALUATED');
      expect(a.calls).toBe(3);
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
      expect(out.report!.runs[1]).toMatchObject({ status: 'ok', attempts: 3, model: 'fake-model' });
    });

    it('gives up after maxAttempts and returns the deterministic feedback as a partial result', async () => {
      const a = fakeEvaluator('ai', () => { throw new TransientEvaluatorError('overloaded'); });
      const { p } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: fastAi }]);
      const out = await p.run(base());
      expect(out.status).toBe('PARTIALLY_EVALUATED');
      expect(a.calls).toBe(3);
      expect(out.report!.complete).toBe(false);
      expect(out.report!.findings.map((f) => f.id)).toContain('r1');
      expect(out.report!.runs[1]).toMatchObject({ status: 'failed', attempts: 3, error: 'overloaded' });
      expect(out.report!.dimensions.every((d) => d.sources.join() === 'rules')).toBe(true);
    });

    it('does not retry a permanent failure', async () => {
      const a = fakeEvaluator('ai', () => { throw new PermanentEvaluatorError('bad credentials'); });
      const { p, sleep } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: fastAi }]);
      const out = await p.run(base());
      expect(a.calls).toBe(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(out.status).toBe('PARTIALLY_EVALUATED');
    });

    it('times out a slow evaluator, aborts its signal, and still returns a partial result', async () => {
      let aborted = false;
      const a = fakeEvaluator('ai', (_c, signal) => new Promise((_res, rej) => { signal.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')); }); }));
      const { p } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: { timeoutMs: 20, maxAttempts: 1, backoffMs: 0 } }]);
      const out = await p.run(base());
      expect(aborted).toBe(true);
      expect(out.status).toBe('PARTIALLY_EVALUATED');
      expect(out.report!.runs[1]).toMatchObject({ status: 'timed_out', error: expect.stringMatching(/did not finish/i) });
    });

    it('times out even when the evaluator ignores its abort signal entirely', async () => {
      const a = fakeEvaluator('ai', () => new Promise(() => {}));
      const { p } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: { timeoutMs: 20, maxAttempts: 1, backoffMs: 0 } }]);
      const out = await p.run(base());
      expect(out.status).toBe('PARTIALLY_EVALUATED');
    });

    it('retries a timeout, and can succeed on the next try', async () => {
      const a = fakeEvaluator('ai', (_c, _s, call) => (call === 1 ? new Promise(() => {}) : result()));
      const { p } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: { timeoutMs: 20, maxAttempts: 2, backoffMs: 1 } }]);
      const out = await p.run(base());
      expect(out.status).toBe('EVALUATED');
      expect(a.calls).toBe(2);
    });

    it('never shows learners raw internal error text', async () => {
      const a = fakeEvaluator('ai', () => { throw new Error('connect ECONNREFUSED 10.0.0.5:443 sk-ant-secret'); });
      const { p } = pipeline([{ evaluator: det(), policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: { ...fastAi, maxAttempts: 1 } }]);
      const out = await p.run(base());
      const err = out.report!.runs[1]!.error!;
      expect(err).not.toMatch(/ECONNREFUSED|sk-ant|10\.0/);
      expect(err).toMatch(/unexpected error/i);
    });
  });

  describe('when the deterministic stage fails', () => {
    it('still reports whatever the AI produced, as partial', async () => {
      const d = fakeEvaluator('deterministic', () => { throw new Error('bug in a rule'); });
      const a = fakeEvaluator('ai', () => result());
      const { p } = pipeline([{ evaluator: d, policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: fastAi }]);
      const out = await p.run(base());
      expect(out.status).toBe('PARTIALLY_EVALUATED');
      expect(out.report!.dimensions.every((x) => x.sources.join() === 'ai')).toBe(true);
    });

    it('fails outright, with a reason and no report, when nothing succeeds', async () => {
      const d = fakeEvaluator('deterministic', () => { throw new Error('bug'); });
      const a = fakeEvaluator('ai', () => { throw new PermanentEvaluatorError('no key'); });
      const { p } = pipeline([{ evaluator: d, policy: DETERMINISTIC_POLICY }, { evaluator: a, policy: fastAi }]);
      const out = await p.run(base());
      expect(out.status).toBe('EVALUATION_FAILED');
      expect(out.report).toBeUndefined();
      expect(out.error).toMatch(/no key/);
    });
  });

  it('refuses to be built with no evaluators', () => {
    expect(() => new EvaluationPipeline([])).toThrow(/at least one evaluator/);
  });
});
