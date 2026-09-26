import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AttemptDto, ProblemListItemDto, ProgressDto } from '../../../shared/contracts';
import type { Container } from '../../src/compositionRoot';
import { DemoDesignReviewer } from '../../src/evaluation/ai/DemoDesignReviewer';
import { goodAnswers, goodAssumptions, goodDecisions, goodParkingLotPayload, weakParkingLotPayload } from '../helpers/fixtures';
import { flakyReviewer, goodReviewer, LEARNER, OTHER_LEARNER, testContainer } from '../helpers/container';

let container: Container;
afterEach(async () => container?.shutdown());

const setup = async (overrides: Parameters<typeof testContainer>[0] = {}) => {
  container = testContainer(overrides);
  await container.start();
  const api = request(container.app);
  const as = (id = LEARNER) => ({
    get: (url: string) => api.get(url).set('X-Learner-Id', id),
    post: (url: string) => api.post(url).set('X-Learner-Id', id),
    put: (url: string) => api.put(url).set('X-Learner-Id', id),
    delete: (url: string) => api.delete(url).set('X-Learner-Id', id),
  });
  return { api, me: as(), as };
};

const draftBody = (over: Record<string, unknown> = {}, baseRevision = 0) => ({
  baseRevision,
  draft: { format: 'crc-cards', design: goodParkingLotPayload, assumptions: goodAssumptions, decisions: goodDecisions, scenarioAnswers: goodAnswers, ...over },
});

async function submitGoodAttempt(h: Awaited<ReturnType<typeof setup>>, payload: unknown = goodParkingLotPayload): Promise<AttemptDto> {
  const started = await h.me.post('/api/attempts').send({ problemId: 'parking-lot' });
  const id = started.body.id as string;
  await h.me.put(`/api/attempts/${id}/draft`).send(draftBody({ design: payload }, started.body.draft.revision)).expect(200);
  await h.me.post(`/api/attempts/${id}/submit`).expect(202);
  await container.queue.idle();
  return (await h.me.get(`/api/attempts/${id}`)).body;
}

describe('catalogue', () => {
  it('lists the problems, without leaking evaluation knowledge', async () => {
    const { api } = await setup();
    const res = await api.get('/api/problems').expect(200);
    const list = res.body as ProblemListItemDto[];
    expect(list.map((p) => p.id)).toEqual(['parking-lot', 'vending-machine', 'rate-limiter', 'elevator']);
    expect(list[0]).toMatchObject({ attemptCount: 0 });
    const detail = (await api.get('/api/problems/parking-lot').expect(200)).body;
    expect(detail.requirements.length).toBeGreaterThan(4);
    expect(detail.scenarios[0]).toEqual({ id: 'S1', prompt: expect.any(String) });
    const raw = JSON.stringify(detail);
    for (const secret of ['keywords', 'capabilities', 'approaches', 'variabilityPoints', 'likelyConcepts']) expect(raw).not.toContain(secret);
  });

  it('404s an unknown problem, with a structured error', async () => {
    const { api } = await setup();
    const res = await api.get('/api/problems/nope').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.stringContaining('nope') } });
  });

  it('reports what feedback to expect and which submission formats exist', async () => {
    const { api } = await setup();
    const res = await api.get('/api/meta').expect(200);
    expect(res.body.aiEnabled).toBe(false);
    expect(res.body.formats.map((f: { id: string }) => f.id)).toEqual(['crc-cards', 'mermaid-class']);
  });
});

describe('the practice loop, without AI', () => {
  it('start → draft → submit → feedback → history', async () => {
    const h = await setup();
    const started = await h.me.post('/api/attempts').send({ problemId: 'parking-lot' }).expect(201);
    expect(started.body).toMatchObject({ status: 'DRAFT', number: 1, problemTitle: 'Parking Lot', aiEnabled: false });
    const id = started.body.id;

    const saved = await h.me.put(`/api/attempts/${id}/draft`).send(draftBody()).expect(200);
    expect(saved.body.draft.revision).toBe(1);

    const submitted = await h.me.post(`/api/attempts/${id}/submit`).expect(202);
    expect(submitted.body.status).toBe('SUBMITTED');
    expect(submitted.body.submission.model.classes.length).toBeGreaterThan(10);

    await container.queue.idle();
    const done = (await h.me.get(`/api/attempts/${id}`).expect(200)).body as AttemptDto;
    expect(done.status).toBe('EVALUATED');
    expect(done.report).toMatchObject({ complete: true, provisional: false });
    expect(done.report!.overall).toBeGreaterThan(3);
    expect(done.report!.dimensions).toHaveLength(5);
    expect(done.report!.coverage.every((c) => c.status === 'covered')).toBe(true);
    expect(done.report!.runs).toEqual([expect.objectContaining({ evaluatorId: 'rules', status: 'ok' })]);

    const history = (await h.me.get('/api/attempts?problemId=parking-lot').expect(200)).body;
    expect(history).toEqual([expect.objectContaining({ id, status: 'EVALUATED', overall: done.report!.overall })]);

    const list = (await h.me.get('/api/problems').expect(200)).body as ProblemListItemDto[];
    expect(list.find((p) => p.id === 'parking-lot')).toMatchObject({ attemptCount: 1, bestScore: done.report!.overall });
  });

  it('a weak design gets actionable next steps and lower scores', async () => {
    const h = await setup();
    const strong = await submitGoodAttempt(h);
    const weakStart = await h.me.post('/api/attempts').send({ problemId: 'vending-machine' });
    // The weak fixture is a parking-lot design; against another problem it should still be judged, and poorly.
    await h.me.put(`/api/attempts/${weakStart.body.id}/draft`).send(draftBody({ design: weakParkingLotPayload, assumptions: '', decisions: '', scenarioAnswers: {} })).expect(200);
    await h.me.post(`/api/attempts/${weakStart.body.id}/submit`).expect(202);
    await container.queue.idle();
    const weak = (await h.me.get(`/api/attempts/${weakStart.body.id}`)).body as AttemptDto;
    expect(weak.report!.overall).toBeLessThan(strong.report!.overall - 1);
    expect(weak.report!.nextSteps).toHaveLength(3);
    expect(weak.report!.nextSteps.every((s) => s.headline && s.action)).toBe(true);
  });

  it('resumes an open draft instead of creating a second one', async () => {
    const h = await setup();
    const a = await h.me.post('/api/attempts').send({ problemId: 'elevator' }).expect(201);
    const b = await h.me.post('/api/attempts').send({ problemId: 'elevator' }).expect(200);
    expect(b.body.id).toBe(a.body.id);
    expect((await h.me.get('/api/attempts?problemId=elevator')).body).toHaveLength(1);
  });

  it('a discarded draft disappears; a submitted attempt cannot be discarded', async () => {
    const h = await setup();
    const a = await h.me.post('/api/attempts').send({ problemId: 'elevator' });
    await h.me.delete(`/api/attempts/${a.body.id}`).expect(204);
    await h.me.get(`/api/attempts/${a.body.id}`).expect(404);
    const done = await submitGoodAttempt(h);
    const res = await h.me.delete(`/api/attempts/${done.id}`).expect(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });
});

describe('revision and progress', () => {
  it('a revision starts from the previous submission, and progress shows what was fixed', async () => {
    const h = await setup();
    const first = await submitGoodAttempt(h, weakParkingLotPayload);
    const revised = await h.me.post('/api/attempts').send({ problemId: 'parking-lot', basedOnAttemptId: first.id }).expect(201);
    expect(revised.body).toMatchObject({ number: 2, basedOnAttemptId: first.id, status: 'DRAFT' });
    expect(revised.body.draft.design).toEqual(weakParkingLotPayload);

    await h.me.put(`/api/attempts/${revised.body.id}/draft`).send(draftBody({}, 0)).expect(200);
    await h.me.post(`/api/attempts/${revised.body.id}/submit`).expect(202);
    await container.queue.idle();

    const progress = (await h.me.get('/api/problems/parking-lot/progress').expect(200)).body as ProgressDto;
    expect(progress.attempts.map((a) => a.number)).toEqual([1, 2]);
    const c = progress.comparison!;
    expect([c.fromNumber, c.toNumber]).toEqual([1, 2]);
    expect(c.overallDelta).toBeGreaterThan(0.5); // strong is capped at 3.4 without an AI review
    expect(c.resolved.map((f) => f.id)).toEqual(expect.arrayContaining(['god-class:ParkingManager', 'vague-names']));
    expect(c.introduced).toEqual([]);
    expect(c.dimensionDeltas.every((d) => d.delta >= 0)).toBe(true);
  });

  it('progress has no comparison until there are two evaluated attempts', async () => {
    const h = await setup();
    await submitGoodAttempt(h);
    const p = (await h.me.get('/api/problems/parking-lot/progress')).body as ProgressDto;
    expect(p.attempts).toHaveLength(1);
    expect(p.comparison).toBeUndefined();
  });

  it('cannot revise a draft, someone else\'s attempt, or while another draft is open', async () => {
    const h = await setup();
    const draft = await h.me.post('/api/attempts').send({ problemId: 'parking-lot' });
    expect((await h.me.post('/api/attempts').send({ problemId: 'parking-lot', basedOnAttemptId: draft.body.id })).status).toBe(409);
    await h.me.put(`/api/attempts/${draft.body.id}/draft`).send(draftBody());
    await h.me.post(`/api/attempts/${draft.body.id}/submit`);
    await container.queue.idle();
    await h.me.post('/api/attempts').send({ problemId: 'parking-lot', basedOnAttemptId: draft.body.id }).expect(201);
    const clash = await h.me.post('/api/attempts').send({ problemId: 'parking-lot', basedOnAttemptId: draft.body.id }).expect(409);
    expect(clash.body.error.message).toMatch(/already have a draft/);
    await h.as(OTHER_LEARNER).post('/api/attempts').send({ problemId: 'parking-lot', basedOnAttemptId: draft.body.id }).expect(404);
  });

  it('common approaches unlock only after a first submission', async () => {
    const h = await setup();
    const before = await h.me.get('/api/problems/parking-lot/approaches').expect(403);
    expect(before.body.error.code).toBe('POLICY');
    await h.me.post('/api/attempts').send({ problemId: 'parking-lot' });
    await h.me.get('/api/problems/parking-lot/approaches').expect(403); // an open draft does not count
    await submitGoodAttempt(h).catch(() => {}); // resumes the draft above and submits it
    const after = await h.me.get('/api/problems/parking-lot/approaches').expect(200);
    expect(after.body.length).toBeGreaterThanOrEqual(2);
    expect(after.body[0]).toEqual(expect.objectContaining({ title: expect.any(String), tradeoffs: expect.any(Array) }));
  });
});

describe('validation and safety', () => {
  it('refuses to submit a design that cannot be parsed, and says what to fix', async () => {
    const h = await setup();
    const a = await h.me.post('/api/attempts').send({ problemId: 'parking-lot' });
    const empty = await h.me.post(`/api/attempts/${a.body.id}/submit`).expect(422);
    expect(empty.body.error.code).toBe('VALIDATION_FAILED');
    expect(empty.body.error.details[0].message).toMatch(/at least one class/i);
    expect((await h.me.get(`/api/attempts/${a.body.id}`)).body.status).toBe('DRAFT');

    const bad = draftBody({ design: { classes: [{ name: 'A' }], relationships: [{ from: 'A', to: 'Ghost', kind: 'association' }] } });
    await h.me.put(`/api/attempts/${a.body.id}/draft`).send(bad).expect(200); // drafts may be work in progress
    const res = await h.me.post(`/api/attempts/${a.body.id}/submit`).expect(422);
    expect(res.body.error.details.map((d: { message: string }) => d.message).join()).toMatch(/Ghost/);
  });

  it('preflight reports errors and stats without touching any attempt', async () => {
    const { api } = await setup();
    const bad = await api.post('/api/preflight').send({ format: 'mermaid-class', design: { source: 'graph TD' } }).expect(200);
    expect(bad.body).toMatchObject({ ok: false, issues: [expect.objectContaining({ severity: 'error' })] });
    const ok = await api.post('/api/preflight').send({ format: 'crc-cards', design: goodParkingLotPayload }).expect(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.stats).toMatchObject({ classes: 18, abstractions: 4 });
    expect(ok.body.model.classes).toHaveLength(18);
    await api.post('/api/preflight').send({ format: 'nope', design: {} }).expect(422);
  });

  it('accepts a Mermaid submission end to end (a second format, same evaluators)', async () => {
    const h = await setup();
    const a = await h.me.post('/api/attempts').send({ problemId: 'parking-lot' });
    const source = ['classDiagram', '  class ParkingLot', '  class Level', '  class ParkingSpot', '  class Ticket', '  class PricingStrategy { <<interface>> }',
      '  ParkingLot *-- Level', '  Level *-- ParkingSpot', '  ParkingLot ..> Ticket', '  ParkingLot --> PricingStrategy',
      '  note for ParkingLot "Coordinates entry and exit"'].join('\n').replace('{ <<interface>> }', '\n    <<interface>>\n  }').replace('class PricingStrategy \n', 'class PricingStrategy {\n');
    await h.me.put(`/api/attempts/${a.body.id}/draft`).send(draftBody({ format: 'mermaid-class', design: { source } })).expect(200);
    await h.me.post(`/api/attempts/${a.body.id}/submit`).expect(202);
    await container.queue.idle();
    const done = (await h.me.get(`/api/attempts/${a.body.id}`)).body as AttemptDto;
    expect(done.status).toBe('EVALUATED');
    expect(done.submission!.format).toBe('mermaid-class');
    expect(done.report!.findings.some((f) => f.ruleId === 'dead-abstraction')).toBe(true);
  });

  it('keeps learners apart: another learner sees 404, never someone else\'s data', async () => {
    const h = await setup();
    const mine = await submitGoodAttempt(h);
    const other = h.as(OTHER_LEARNER);
    await other.get(`/api/attempts/${mine.id}`).expect(404);
    await other.post(`/api/attempts/${mine.id}/retry`).expect(404);
    await other.delete(`/api/attempts/${mine.id}`).expect(404);
    expect((await other.get('/api/attempts')).body).toEqual([]);
    expect((await other.get('/api/problems')).body.find((p: ProblemListItemDto) => p.id === 'parking-lot').attemptCount).toBe(0);
  });

  it('requires a valid learner id, and rejects malformed or oversized bodies', async () => {
    const { api, me } = await setup();
    await api.get('/api/attempts').expect(400);
    await api.get('/api/attempts').set('X-Learner-Id', 'short').expect(400);
    await api.get('/api/attempts').set('X-Learner-Id', 'has spaces and ../ slashes').expect(400);
    const badJson = await api.post('/api/attempts').set('X-Learner-Id', LEARNER).set('Content-Type', 'application/json').send('{oops').expect(400);
    expect(badJson.body.error.code).toBe('BAD_REQUEST');
    await me.post('/api/attempts').send({}).expect(400);
    const big = await me.post('/api/preflight').send({ format: 'mermaid-class', design: { source: 'x'.repeat(300_000) } }).expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    await api.get('/api/nothing-here').expect(404);
  });

  it('bounds text fields on draft saves', async () => {
    const h = await setup();
    const a = await h.me.post('/api/attempts').send({ problemId: 'parking-lot' });
    const res = await h.me.put(`/api/attempts/${a.body.id}/draft`).send(draftBody({ assumptions: 'x'.repeat(4001) })).expect(400);
    expect(res.body.error.details[0].path).toBe('draft.assumptions');
  });

  it('does not expose stack traces or internals on unexpected errors', async () => {
    const h = await setup();
    container.service.getProblem = () => { throw new Error('db password is hunter2'); };
    const res = await h.api.get('/api/problems/parking-lot').expect(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } });
  });
});

describe('autosave races', () => {
  it('rejects an out-of-date save with 409 and keeps the newer draft', async () => {
    const h = await setup();
    const a = await h.me.post('/api/attempts').send({ problemId: 'parking-lot' });
    await h.me.put(`/api/attempts/${a.body.id}/draft`).send(draftBody({ assumptions: 'from tab A' }, 0)).expect(200);
    const stale = await h.me.put(`/api/attempts/${a.body.id}/draft`).send(draftBody({ assumptions: 'from tab B' }, 0)).expect(409);
    expect(stale.body.error.code).toBe('STALE_DRAFT');
    expect((await h.me.get(`/api/attempts/${a.body.id}`)).body.draft.assumptions).toBe('from tab A');
  });

  it('cannot edit or re-submit after submitting', async () => {
    const h = await setup();
    const done = await submitGoodAttempt(h);
    await h.me.put(`/api/attempts/${done.id}/draft`).send(draftBody({}, done.draft.revision)).expect(409);
    await h.me.post(`/api/attempts/${done.id}/submit`).expect(409);
  });

  it('two concurrent starts get distinct attempt numbers (or resume the same draft)', async () => {
    const h = await setup();
    const first = await submitGoodAttempt(h);
    const [a, b] = await Promise.all([
      h.me.post('/api/attempts').send({ problemId: 'parking-lot', basedOnAttemptId: first.id }),
      h.me.post('/api/attempts').send({ problemId: 'parking-lot', basedOnAttemptId: first.id }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
});

describe('with an AI reviewer', () => {
  it('blends the AI review into the report and says which model judged', async () => {
    const h = await setup({ reviewer: goodReviewer() });
    const done = await submitGoodAttempt(h);
    expect(done.aiEnabled).toBe(true);
    expect(done.status).toBe('EVALUATED');
    expect(done.report!.runs.map((r) => r.evaluatorId)).toEqual(['rules', 'ai-review']);
    expect(done.report!.runs[1]!.model).toMatch(/demo/);
    expect(done.report!.summary).toMatch(/demo/i);
    expect(done.report!.dimensions[0]!.sources).toEqual(['rules', 'ai']);
    expect((await h.api.get('/api/meta')).body).toMatchObject({ aiEnabled: true, aiModel: expect.stringContaining('demo') });
  });

  it('retries a flaky reviewer within one evaluation and still completes', async () => {
    const reviewer = flakyReviewer(1);
    const h = await setup({ reviewer });
    const done = await submitGoodAttempt(h);
    expect(done.status).toBe('EVALUATED');
    expect(reviewer.calls).toBe(2);
    expect(done.report!.runs[1]).toMatchObject({ status: 'ok', attempts: 2 });
  });

  it('when the reviewer is down: partial feedback right away, then a successful retry upgrades it', async () => {
    const reviewer = flakyReviewer(2); // exhausts the first evaluation's two tries, succeeds afterwards
    const h = await setup({ reviewer });
    const partial = await submitGoodAttempt(h);
    expect(partial.status).toBe('PARTIALLY_EVALUATED');
    expect(partial.report!.complete).toBe(false);
    expect(partial.report!.findings.length).toBeGreaterThan(0);
    expect(partial.report!.overall).toBeGreaterThan(3); // the structural feedback is all there
    expect(partial.report!.runs[1]).toMatchObject({ status: 'failed', attempts: 2, error: expect.stringContaining('unavailable') });
    expect(partial.evaluation.lastError).toMatch(/AI design review/);

    await h.me.post(`/api/attempts/${partial.id}/retry`).expect(202);
    await container.queue.idle();
    const healed = (await h.me.get(`/api/attempts/${partial.id}`)).body as AttemptDto;
    expect(healed.status).toBe('EVALUATED');
    expect(healed.report!.complete).toBe(true);
    expect(healed.evaluation.runsStarted).toBe(2);
    await h.me.post(`/api/attempts/${partial.id}/retry`).expect(409); // nothing left to retry
  });

  it('a permanently failing reviewer still yields feedback, and retries stay bounded', async () => {
    const h = await setup({ reviewer: new DemoDesignReviewer({ mode: 'fail' }) });
    let a = await submitGoodAttempt(h);
    expect(a.status).toBe('PARTIALLY_EVALUATED');
    for (let i = 0; i < 4; i++) {
      await h.me.post(`/api/attempts/${a.id}/retry`).expect(202);
      await container.queue.idle();
      a = (await h.me.get(`/api/attempts/${a.id}`)).body;
      expect(a.status).toBe('PARTIALLY_EVALUATED');
    }
    const limit = await h.me.post(`/api/attempts/${a.id}/retry`).expect(429);
    expect(limit.body.error.code).toBe('RETRY_LIMIT');
  });

  it('while the reviewer is slow the attempt is EVALUATING with provisional feedback the learner can already read', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const reviewer = { model: 'gated', review: async (i: never, s: AbortSignal) => { await gate; return new DemoDesignReviewer({ latencyMs: 0 }).review(i, s); } };
    const h = await setup({ reviewer });
    const a = await h.me.post('/api/attempts').send({ problemId: 'parking-lot' });
    await h.me.put(`/api/attempts/${a.body.id}/draft`).send(draftBody()).expect(200);
    await h.me.post(`/api/attempts/${a.body.id}/submit`).expect(202);
    let mid: AttemptDto | undefined;
    for (let i = 0; i < 50 && !mid?.report; i++) {
      await new Promise((r) => setTimeout(r, 10));
      mid = (await h.me.get(`/api/attempts/${a.body.id}`)).body;
    }
    expect(mid!.status).toBe('EVALUATING');
    expect(mid!.report).toMatchObject({ provisional: true, complete: false });
    expect(mid!.report!.findings.length).toBeGreaterThan(0);
    // and the learner cannot retry or edit while it runs
    await h.me.post(`/api/attempts/${a.body.id}/retry`).expect(409);
    release();
    await container.queue.idle();
    expect((await h.me.get(`/api/attempts/${a.body.id}`)).body.status).toBe('EVALUATED');
  });

  it('a hung reviewer is cut off by its time budget', async () => {
    const hung = { model: 'hung', review: () => new Promise<never>(() => {}) };
    const h = await setup({ reviewer: hung });
    const a = await h.me.post('/api/attempts').send({ problemId: 'parking-lot' });
    await h.me.put(`/api/attempts/${a.body.id}/draft`).send(draftBody()).expect(200);
    // shrink the budget for the test: config timeout is 1000ms with 2 attempts; keep the test quick by only waiting for it
    await h.me.post(`/api/attempts/${a.body.id}/submit`).expect(202);
    await container.queue.idle();
    const done = (await h.me.get(`/api/attempts/${a.body.id}`)).body as AttemptDto;
    expect(done.status).toBe('PARTIALLY_EVALUATED');
    expect(done.report!.runs[1]).toMatchObject({ status: 'timed_out', attempts: 2 });
  }, 15_000);
});

describe('restart recovery', () => {
  it('finishes evaluations that were queued when the previous process stopped', async () => {
    const first = testContainer();
    // Not started: nothing drains the queue, as if the process died right after accepting the submission.
    const r1 = request(first.app);
    const a = await r1.post('/api/attempts').set('X-Learner-Id', LEARNER).send({ problemId: 'parking-lot' });
    await r1.put(`/api/attempts/${a.body.id}/draft`).set('X-Learner-Id', LEARNER).send(draftBody());
    await r1.post(`/api/attempts/${a.body.id}/submit`).set('X-Learner-Id', LEARNER).expect(202);
    expect((await first.repository.findById(a.body.id))!.status).toBe('SUBMITTED');

    container = testContainer({ repository: first.repository });
    const { recovered } = await container.start();
    expect(recovered).toBe(1);
    await container.queue.idle();
    expect((await container.repository.findById(a.body.id))!.status).toBe('EVALUATED');
  });
});
