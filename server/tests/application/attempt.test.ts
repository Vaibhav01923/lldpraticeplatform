import { describe, it, expect } from 'vitest';
import { Attempt, MAX_EVALUATION_RUNS } from '../../src/domain/attempt/Attempt';
import { InvalidTransitionError, RetryLimitError, StaleDraftError } from '../../src/domain/errors';
import { TRANSITIONS, canTransition } from '../../src/domain/attempt/AttemptStatus';
import { crcSubmission } from '../helpers/fixtures';
import type { DraftInputDto, EvaluationReportDto } from '../../../shared/contracts';

const t0 = new Date('2026-01-01T10:00:00Z');
const later = (m: number) => new Date(t0.getTime() + m * 60_000);
const input = (over: Partial<DraftInputDto> = {}): DraftInputDto => ({ format: 'crc-cards', design: { classes: [], relationships: [] }, assumptions: 'a', decisions: 'd', scenarioAnswers: {}, ...over });
const report = (over: Partial<EvaluationReportDto> = {}): EvaluationReportDto => ({
  provisional: false, complete: true, overall: 3, band: 'Solid', dimensions: [{ dimension: 'requirements', label: 'R', score: 3, band: 'Solid', rationale: [], caps: [], sources: ['rules'] }],
  findings: [], nextSteps: [], coverage: [], alternatives: [], reflectionQuestions: [], runs: [{ evaluatorId: 'rules', kind: 'deterministic', label: 'Rules', status: 'ok', durationMs: 1, attempts: 1 }], generatedAt: t0.toISOString(), ...over,
});
const fresh = () => Attempt.start({ id: 'a1', learnerId: 'L', problemId: 'parking-lot', number: 1, now: t0, formatId: 'crc-cards', starterDesign: { classes: [], relationships: [] } });
const submitted = () => { const a = fresh(); a.submit(crcSubmission(), later(1)); return a; };
const evaluating = () => { const a = submitted(); a.beginEvaluation(later(2)); return a; };

describe('Attempt lifecycle', () => {
  it('starts as an empty DRAFT at revision 0', () => {
    const a = fresh();
    expect(a).toMatchObject({ status: 'DRAFT' });
    expect(a.draft.revision).toBe(0);
    expect(a.report).toBeUndefined();
  });

  it('walks DRAFT → SUBMITTED → EVALUATING → EVALUATED', () => {
    const a = fresh();
    a.saveDraft(input(), 0, later(1));
    a.submit(crcSubmission(), later(2));
    expect(a.status).toBe('SUBMITTED');
    a.beginEvaluation(later(3));
    expect(a.status).toBe('EVALUATING');
    expect(a.evaluation.runsStarted).toBe(1);
    a.completeEvaluation('EVALUATED', report(), later(4));
    expect(a.status).toBe('EVALUATED');
    expect(a.report!.overall).toBe(3);
    expect(a.toSnapshot().submittedAt).toBeDefined();
  });

  it('every illegal transition is rejected, and terminal EVALUATED accepts none', () => {
    const all = Object.keys(TRANSITIONS) as (keyof typeof TRANSITIONS)[];
    for (const from of all) for (const to of all) expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to));
    expect(TRANSITIONS.EVALUATED).toEqual([]);
  });

  it('cannot skip evaluation or be submitted twice', () => {
    const a = fresh();
    expect(() => a.beginEvaluation(t0)).toThrow(InvalidTransitionError);
    expect(() => a.completeEvaluation('EVALUATED', report(), t0)).toThrow(InvalidTransitionError);
    a.submit(crcSubmission(), later(1));
    expect(() => a.submit(crcSubmission(), later(2))).toThrow(InvalidTransitionError);
  });

  it('a submitted attempt can no longer be edited', () => {
    const a = submitted();
    expect(() => a.saveDraft(input(), 1, later(5))).toThrow(/can no longer be edited/);
  });
});

describe('draft revisions', () => {
  it('increments the revision on each save', () => {
    const a = fresh();
    a.saveDraft(input({ assumptions: 'one' }), 0, later(1));
    a.saveDraft(input({ assumptions: 'two' }), 1, later(2));
    expect(a.draft).toMatchObject({ revision: 2, assumptions: 'two' });
  });

  it('rejects an autosave made against a stale revision, without changing the draft', () => {
    const a = fresh();
    a.saveDraft(input({ assumptions: 'newer' }), 0, later(1));
    expect(() => a.saveDraft(input({ assumptions: 'stale' }), 0, later(2))).toThrow(StaleDraftError);
    expect(a.draft.assumptions).toBe('newer');
  });

  it('does not alias the caller\'s object', () => {
    const a = fresh();
    const i = input({ scenarioAnswers: { S1: 'x' } });
    a.saveDraft(i, 0, later(1));
    i.scenarioAnswers['S1'] = 'mutated';
    expect(a.draft.scenarioAnswers['S1']).toBe('x');
  });
});

describe('evaluation outcomes', () => {
  it('records provisional feedback only while evaluating', () => {
    const a = evaluating();
    a.recordProvisionalReport(report({ provisional: true, complete: false }), later(3));
    expect(a.report!.provisional).toBe(true);
    expect(() => submitted().recordProvisionalReport(report(), later(3))).toThrow(InvalidTransitionError);
  });

  it('a partial evaluation remembers why', () => {
    const a = evaluating();
    a.completeEvaluation('PARTIALLY_EVALUATED', report({ complete: false, runs: [{ evaluatorId: 'ai', kind: 'ai', label: 'AI design review', status: 'timed_out', durationMs: 9, attempts: 2, error: 'Did not finish within 60s.' }] }), later(3));
    expect(a.status).toBe('PARTIALLY_EVALUATED');
    expect(a.evaluation.lastError).toBe('AI design review: Did not finish within 60s.');
  });

  it('a failed evaluation keeps the reason and can be retried; the old feedback survives a retry', () => {
    const a = evaluating();
    a.recordProvisionalReport(report({ provisional: true }), later(3));
    a.failEvaluation('boom', later(4));
    expect(a).toMatchObject({ status: 'EVALUATION_FAILED' });
    a.requestRetry(later(5));
    expect(a.status).toBe('SUBMITTED');
    a.beginEvaluation(later(6));
    expect(a.evaluation.lastError).toBeUndefined();
    expect(a.evaluation.runsStarted).toBe(2);
    expect(a.report).toBeDefined();
  });

  it('cannot retry a finished, fully evaluated attempt, nor one that is in flight', () => {
    const done = evaluating();
    done.completeEvaluation('EVALUATED', report(), later(3));
    expect(() => done.requestRetry(later(4))).toThrow(InvalidTransitionError);
    expect(() => evaluating().requestRetry(later(4))).toThrow(InvalidTransitionError);
  });

  it('regression: a learner cannot re-queue an attempt that a worker is still evaluating', () => {
    const a = evaluating();
    expect(() => a.requestRetry(later(4))).toThrow(/Only a partial or failed evaluation/);
    expect(a.status).toBe('EVALUATING');
    expect(() => submitted().requeueInterrupted(later(4))).toThrow(InvalidTransitionError);
  });

  it('caps the total number of evaluation runs', () => {
    const a = submitted();
    for (let i = 0; i < MAX_EVALUATION_RUNS; i++) {
      a.beginEvaluation(later(10 + i));
      a.failEvaluation('again', later(10 + i));
      if (i < MAX_EVALUATION_RUNS - 1) a.requestRetry(later(10 + i));
    }
    expect(() => a.requestRetry(later(99))).toThrow(RetryLimitError);
  });

  it('an interrupted evaluation can be put back in the queue', () => {
    const a = evaluating();
    a.requeueInterrupted(later(3));
    expect(a.status).toBe('SUBMITTED');
  });
});

describe('snapshots and views', () => {
  it('round-trips through a snapshot, including the submission', () => {
    const a = evaluating();
    a.completeEvaluation('EVALUATED', report(), later(3));
    const copy = Attempt.rehydrate(a.toSnapshot());
    expect(copy.toSnapshot()).toEqual(a.toSnapshot());
    expect(copy.submission!.model.classes.length).toBeGreaterThan(5);
  });

  it('the client view hides ownership and adds display fields', () => {
    const dto = fresh().toDto('Parking Lot', true);
    expect(dto).toMatchObject({ problemTitle: 'Parking Lot', aiEnabled: true });
    expect(dto).not.toHaveProperty('learnerId');
  });

  it('summaries show scores only for finished reports, never provisional ones', () => {
    const a = evaluating();
    a.recordProvisionalReport(report({ provisional: true, overall: 2 }), later(3));
    expect(a.summary('P').overall).toBeUndefined();
    a.completeEvaluation('EVALUATED', report({ overall: 3.4 }), later(4));
    expect(a.summary('P')).toMatchObject({ overall: 3.4, band: 'Solid', complete: true, dimensionScores: { requirements: 3 } });
  });

  it('a revision starts from what was submitted, not from later draft state', () => {
    const prev = evaluating();
    prev.completeEvaluation('EVALUATED', report(), later(3));
    const next = Attempt.start({ id: 'a2', learnerId: 'L', problemId: 'parking-lot', number: 2, now: later(10), formatId: 'crc-cards', starterDesign: {}, basedOn: prev });
    expect(next.draft.assumptions).toContain('One lot, one currency');
    expect(next.draft.revision).toBe(0);
    expect(next.toSnapshot().basedOnAttemptId).toBe('a1');
    expect(next.status).toBe('DRAFT');
  });
});
