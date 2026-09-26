import { describe, it, expect, vi } from 'vitest';
import { EvaluationWorker } from '../../src/application/EvaluationWorker';
import { InProcessJobQueue } from '../../src/application/JobQueue';
import { Attempt, MAX_EVALUATION_RUNS } from '../../src/domain/attempt/Attempt';
import { Rubric } from '../../src/domain/evaluation/Rubric';
import { EvaluationPipeline, DETERMINISTIC_POLICY } from '../../src/evaluation/EvaluationPipeline';
import { RuleBasedEvaluator } from '../../src/evaluation/rules/RuleBasedEvaluator';
import { InMemoryAttemptRepository } from '../../src/infrastructure/InMemoryAttemptRepository';
import { defaultCatalog } from '../../src/problems';
import { crcSubmission } from '../helpers/fixtures';
import { fakeEvaluator } from '../helpers/evaluators';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('InProcessJobQueue', () => {
  it('runs jobs in order and reports idle when done', async () => {
    const order: string[] = [];
    const q = new InProcessJobQueue(1);
    q.start(async (id) => { order.push(id); await tick(); });
    q.enqueue('a'); q.enqueue('b'); q.enqueue('c');
    await q.idle();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(q.depth).toBe(0);
  });

  it('never runs more than the configured number at once', async () => {
    let running = 0, peak = 0;
    const q = new InProcessJobQueue(2);
    q.start(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 10)); running--; });
    ['a', 'b', 'c', 'd', 'e'].forEach((id) => q.enqueue(id));
    await q.idle();
    expect(peak).toBe(2);
  });

  it('ignores an id that is already waiting or running', async () => {
    const seen: string[] = [];
    const q = new InProcessJobQueue(1);
    let release!: () => void;
    q.start(async (id) => { seen.push(id); await new Promise<void>((r) => (release = r)); });
    q.enqueue('a'); q.enqueue('a'); q.enqueue('b'); q.enqueue('b');
    await tick();
    release();
    await tick();
    release();
    await q.idle();
    expect(seen).toEqual(['a', 'b']);
  });

  it('keeps going when a handler throws', async () => {
    const seen: string[] = [];
    const q = new InProcessJobQueue(1);
    q.start(async (id) => { seen.push(id); if (id === 'a') throw new Error('boom'); });
    q.enqueue('a'); q.enqueue('b');
    await q.idle();
    expect(seen).toEqual(['a', 'b']);
  });

  it('holds work until a handler is attached, and stops accepting work after stop()', async () => {
    const seen: string[] = [];
    const q = new InProcessJobQueue(1);
    q.enqueue('early');
    expect(q.depth).toBe(1);
    q.start(async (id) => { seen.push(id); });
    await q.idle();
    q.stop();
    q.enqueue('late');
    await tick();
    expect(seen).toEqual(['early']);
  });

  it('idle() resolves immediately on an empty queue, and rejects nonsense concurrency', async () => {
    await new InProcessJobQueue(1).idle();
    expect(() => new InProcessJobQueue(0)).toThrow();
  });
});

describe('EvaluationWorker', () => {
  const problems = defaultCatalog();
  const setup = (evaluators = [{ evaluator: new RuleBasedEvaluator(), policy: DETERMINISTIC_POLICY }] as ConstructorParameters<typeof EvaluationPipeline>[0]) => {
    const repo = new InMemoryAttemptRepository();
    const worker = new EvaluationWorker({ attempts: repo, problems, pipeline: new EvaluationPipeline(evaluators, undefined, { sleep: async () => {} }), rubric: Rubric.standard });
    return { repo, worker };
  };
  let counter = 0; // attempt numbers are unique per learner and problem, as the repository enforces
  const submitted = async (repo: InMemoryAttemptRepository, id = 'a1') => {
    const a = Attempt.start({ id, learnerId: 'L', problemId: 'parking-lot', number: ++counter, now: new Date(), formatId: 'crc-cards', starterDesign: {} });
    a.submit(crcSubmission(), new Date());
    await repo.save(a);
    return a;
  };

  it('evaluates a submitted attempt and stores the report', async () => {
    const { repo, worker } = setup();
    await submitted(repo);
    await worker.handle('a1');
    const a = (await repo.findById('a1'))!;
    expect(a.status).toBe('EVALUATED');
    expect(a.report!.overall).toBeGreaterThan(3);
    expect(a.evaluation.runsStarted).toBe(1);
  });

  it('is idempotent: a second delivery of the same job does nothing', async () => {
    const { repo, worker } = setup();
    await submitted(repo);
    await worker.handle('a1');
    const before = (await repo.findById('a1'))!.toSnapshot();
    await worker.handle('a1');
    expect((await repo.findById('a1'))!.toSnapshot()).toEqual(before);
  });

  it('ignores unknown ids and drafts', async () => {
    const { repo, worker } = setup();
    await worker.handle('ghost');
    await repo.save(Attempt.start({ id: 'd', learnerId: 'L', problemId: 'parking-lot', number: 1, now: new Date(), formatId: 'crc-cards', starterDesign: {} }));
    await worker.handle('d');
    expect((await repo.findById('d'))!.status).toBe('DRAFT');
  });

  it('records a failure the learner can retry when every evaluator fails', async () => {
    const { repo, worker } = setup([{ evaluator: fakeEvaluator('deterministic', () => { throw new Error('bug'); }), policy: DETERMINISTIC_POLICY }]);
    await submitted(repo);
    await worker.handle('a1');
    const a = (await repo.findById('a1'))!;
    expect(a.status).toBe('EVALUATION_FAILED');
    expect(a.evaluation.lastError).toBeTruthy();
  });

  it('never leaves an attempt stuck in EVALUATING when the pipeline itself blows up', async () => {
    const repo = new InMemoryAttemptRepository();
    const exploding = { hasAi: false, run: async () => { throw new Error('unexpected'); } } as unknown as EvaluationPipeline;
    const worker = new EvaluationWorker({ attempts: repo, problems, pipeline: exploding, rubric: Rubric.standard });
    await submitted(repo);
    await worker.handle('a1');
    expect((await repo.findById('a1'))!.status).toBe('EVALUATION_FAILED');
  });

  it('fails an attempt whose problem has been removed from the catalogue, rather than hanging', async () => {
    const { repo } = setup();
    const worker = new EvaluationWorker({ attempts: repo, problems: { list: () => [], get: () => undefined }, pipeline: new EvaluationPipeline([{ evaluator: new RuleBasedEvaluator(), policy: DETERMINISTIC_POLICY }]), rubric: Rubric.standard });
    await submitted(repo);
    await worker.handle('a1');
    expect((await repo.findById('a1'))!.status).toBe('EVALUATION_FAILED');
  });

  it('saves provisional feedback while slower evaluators are still running', async () => {
    const { repo, worker } = setup();
    let observed: string | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowAi = fakeEvaluator('ai', async () => {
      observed = (await repo.findById('a1'))!.report?.provisional ? 'provisional' : 'none';
      release();
      await gate;
      return { assessments: [], findings: [{ id: 'x', ruleId: 'x', dimension: 'communication', severity: 'minor', title: 't', detail: 'd', evidence: [], source: 'ai', confidence: 'low' }] };
    });
    const w = new EvaluationWorker({ attempts: repo, problems, pipeline: new EvaluationPipeline([{ evaluator: new RuleBasedEvaluator(), policy: DETERMINISTIC_POLICY }, { evaluator: slowAi, policy: { timeoutMs: 1000, maxAttempts: 1, backoffMs: 0 } }]), rubric: Rubric.standard });
    await submitted(repo);
    await w.handle('a1');
    expect(observed).toBe('provisional');
    expect((await repo.findById('a1'))!.status).toBe('EVALUATED');
    void worker;
  });

  describe('recover()', () => {
    it('re-queues submitted and interrupted attempts, but not finished ones or drafts', async () => {
      const { repo, worker } = setup();
      await submitted(repo, 'waiting');
      const interrupted = await submitted(repo, 'interrupted');
      interrupted.beginEvaluation(new Date());
      await repo.save(interrupted);
      await submitted(repo, 'done');
      await worker.handle('done'); // runs to completion: EVALUATED
      expect((await repo.findById('done'))!.status).toBe('EVALUATED');
      await repo.save(Attempt.start({ id: 'draft', learnerId: 'L', problemId: 'parking-lot', number: 99, now: new Date(), formatId: 'crc-cards', starterDesign: {} }));

      const queued: string[] = [];
      const recovered = await worker.recover({ enqueue: (id) => queued.push(id) });
      expect(queued.sort()).toEqual(['interrupted', 'waiting']);
      expect(recovered).toBe(2);
      expect((await repo.findById('interrupted'))!.status).toBe('SUBMITTED');
    });

    it('gives up on an attempt that keeps being interrupted, so a poison submission cannot crash-loop the server', async () => {
      const { repo, worker } = setup();
      const a = await submitted(repo);
      for (let i = 0; i < MAX_EVALUATION_RUNS; i++) {
        a.beginEvaluation(new Date());
        if (i < MAX_EVALUATION_RUNS - 1) a.requeueInterrupted(new Date());
      }
      await repo.save(a);
      const enqueue = vi.fn();
      await worker.recover({ enqueue });
      expect(enqueue).not.toHaveBeenCalled();
      expect((await repo.findById('a1'))!.status).toBe('EVALUATION_FAILED');
    });

    it('drains recovered work end to end through the queue', async () => {
      const { repo, worker } = setup();
      await submitted(repo, 'a1');
      await submitted(repo, 'a2').then(async (a) => { a.beginEvaluation(new Date()); await repo.save(a); });
      const queue = new InProcessJobQueue(2);
      queue.start((id) => worker.handle(id));
      await worker.recover(queue);
      await queue.idle();
      expect((await repo.findById('a1'))!.status).toBe('EVALUATED');
      expect((await repo.findById('a2'))!.status).toBe('EVALUATED');
    });
  });
});
