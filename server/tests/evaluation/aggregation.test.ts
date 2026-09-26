import { describe, it, expect } from 'vitest';
import { Rubric } from '../../src/domain/evaluation/Rubric';
import { DEFAULT_POLICY, ScoreAggregator } from '../../src/evaluation/ScoreAggregator';
import { FeedbackPrioritizer } from '../../src/evaluation/FeedbackPrioritizer';
import { ReportAssembler } from '../../src/evaluation/ReportAssembler';
import { assessAll, result, ruleFinding } from '../helpers/evaluators';
import { finding } from '../../src/domain/evaluation/Finding';

const rules = { id: 'rules', kind: 'deterministic' as const, label: 'Rules' };
const ai = { id: 'ai', kind: 'ai' as const, label: 'AI' };
const rubric = Rubric.standard;
const dim = (r: ReturnType<ScoreAggregator['aggregate']>, d: string) => r.dimensions.find((x) => x.dimension === d)!;

describe('Rubric', () => {
  it('has weights that sum to one and bands that cover the range', () => {
    expect(rubric.dimensions.reduce((s, d) => s + d.weight, 0)).toBeCloseTo(1);
    expect([0, 1, 2, 3, 4].map(Rubric.band)).toEqual(['Not yet', 'Weak', 'Developing', 'Solid', 'Strong']);
    expect(rubric.overall({ requirements: 4, responsibilities: 4, abstractions: 4, extensibility: 4, communication: 4 })).toBe(4);
  });
  it('weights extensibility (25%) above requirements coverage (20%)', () => {
    expect(rubric.dimension('extensibility').weight).toBe(0.25);
    expect(rubric.dimension('requirements').weight).toBe(0.2);
    expect(rubric.dimensions.map((d) => d.weight).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
  it('rejects a rubric whose weights do not sum to one', () => {
    expect(() => new Rubric(rubric.dimensions.map((d) => ({ ...d, weight: 0.3 })))).toThrow(/sum to 1/);
  });
});

describe('ScoreAggregator', () => {
  const agg = new ScoreAggregator();

  it('uses the deterministic score alone when there is no AI review', () => {
    const r = agg.aggregate(rubric, [{ evaluator: rules, result: result({ assessments: assessAll(2.5) }) }]);
    expect(r.dimensions.every((d) => d.score === 2.5 && d.sources.join() === 'rules')).toBe(true);
    expect(r.overall).toBe(2.5);
    expect(r.band).toBe('Solid');
  });

  it('guard: the structural-only ceiling stays inside the "Solid" band (raising it to 3.5 would make unreviewed designs "Strong")', () => {
    expect(Rubric.band(DEFAULT_POLICY.structuralOnlyMax)).toBe('Solid');
    expect(Rubric.band(DEFAULT_POLICY.structuralOnlyMax + 0.1)).toBe('Strong');
  });

  it('cannot award the top band from structural checks alone, and says why', () => {
    const r = agg.aggregate(rubric, [{ evaluator: rules, result: result({ assessments: assessAll(4) }) }]);
    expect(r.overall).toBe(3.4);
    expect(r.band).toBe('Solid');
    expect(dim(r, 'requirements').caps[0]).toMatch(/Capped at 3\.4.*needs an AI review/);
  });

  it('lets a dimension reach the top band once an AI review has also judged it', () => {
    const r = agg.aggregate(rubric, [
      { evaluator: rules, result: result({ assessments: assessAll(4) }) },
      { evaluator: ai, result: result({ assessments: assessAll(4) }) },
    ]);
    expect(r.overall).toBe(4);
    expect(r.band).toBe('Strong');
    expect(dim(r, 'requirements').caps).toEqual([]);
  });

  it('applies the structural-only ceiling per dimension: only where the AI said nothing', () => {
    const r = agg.aggregate(rubric, [
      { evaluator: rules, result: result({ assessments: assessAll(4) }) },
      { evaluator: ai, result: result({ assessments: assessAll(4).filter((a) => a.dimension === 'requirements') }) },
    ]);
    expect(dim(r, 'requirements').score).toBe(4);
    expect(dim(r, 'communication').score).toBe(3.4);
  });

  it('blends deterministic and AI scores 40/60', () => {
    const r = agg.aggregate(rubric, [
      { evaluator: rules, result: result({ assessments: assessAll(2) }) },
      { evaluator: ai, result: result({ assessments: assessAll(3) }) },
    ]);
    expect(dim(r, 'requirements').score).toBe(2.6);
    expect(dim(r, 'requirements').sources).toEqual(['rules', 'ai']);
  });

  it('will not let the AI be far more generous than the structural checks, and says so', () => {
    const r = agg.aggregate(rubric, [
      { evaluator: rules, result: result({ assessments: assessAll(1.5) }) },
      { evaluator: ai, result: result({ assessments: assessAll(4) }) },
    ]);
    // AI limited to 1.5 + 1 = 2.5 → 0.4*1.5 + 0.6*2.5 = 2.1
    expect(dim(r, 'requirements').score).toBe(2.1);
    expect(dim(r, 'requirements').rationale.join(' ')).toMatch(/differs a lot.*limited to 2\.5/);
  });

  it('lets the AI mark down by up to two bands', () => {
    const r = agg.aggregate(rubric, [
      { evaluator: rules, result: result({ assessments: assessAll(3.5) }) },
      { evaluator: ai, result: result({ assessments: assessAll(0) }) },
    ]);
    // AI limited to 3.5 - 2 = 1.5 → 0.4*3.5 + 0.6*1.5 = 2.3
    expect(dim(r, 'communication').score).toBe(2.3);
  });

  it('applies a deterministic cap regardless of what the AI says', () => {
    const r = agg.aggregate(rubric, [
      { evaluator: rules, result: result({ assessments: assessAll(3.5), caps: [{ dimension: 'all', max: 1.5, reason: 'too small' }] }) },
      { evaluator: ai, result: result({ assessments: assessAll(4) }) },
    ]);
    for (const d of r.dimensions) {
      expect(d.score).toBe(1.5);
      expect(d.caps).toEqual(['Capped at 1.5: too small']);
    }
  });

  it('only reports a cap when it actually binds', () => {
    const r = agg.aggregate(rubric, [{ evaluator: rules, result: result({ assessments: assessAll(1), caps: [{ dimension: 'requirements', max: 2.5, reason: 'x' }] }) }]);
    expect(dim(r, 'requirements').caps).toEqual([]);
  });

  it('reports an unassessed dimension as zero with an explanation, rather than inventing a score', () => {
    const r = agg.aggregate(rubric, [{ evaluator: rules, result: result({ assessments: assessAll(3).filter((a) => a.dimension !== 'extensibility') }) }]);
    expect(dim(r, 'extensibility')).toMatchObject({ score: 0, sources: [] });
    expect(dim(r, 'extensibility').rationale).toContain('This dimension could not be assessed.');
  });

  it('falls back to the AI score when the deterministic evaluators produced nothing', () => {
    const r = agg.aggregate(rubric, [{ evaluator: ai, result: result({ assessments: assessAll(3) }) }]);
    expect(dim(r, 'requirements')).toMatchObject({ score: 3, sources: ['ai'] });
  });
});

describe('FeedbackPrioritizer', () => {
  const p = new FeedbackPrioritizer();

  it('ranks by severity, keeps strengths last, and limits advice per dimension', () => {
    const findings = [
      ruleFinding({ id: 'a', severity: 'minor', dimension: 'communication' }),
      finding({ ruleId: 'good', dimension: 'abstractions', severity: 'strength', title: 'Nice', detail: 'd' }),
      ruleFinding({ id: 'b', severity: 'major', dimension: 'requirements' }),
      ruleFinding({ id: 'c', severity: 'major', dimension: 'requirements' }),
      ruleFinding({ id: 'd', severity: 'major', dimension: 'requirements' }),
      ruleFinding({ id: 'e', severity: 'critical', dimension: 'responsibilities' }),
    ];
    const { ordered, nextSteps } = new FeedbackPrioritizer(4, 2).prioritize(findings, rubric);
    expect(ordered[0]!.id).toBe('e');
    expect(ordered.at(-1)!.severity).toBe('strength');
    expect(nextSteps).toHaveLength(4);
    // Three requirements findings compete, but only two may lead; the fourth slot goes to a different dimension.
    expect(nextSteps.filter((s) => ['b', 'c', 'd'].includes(s.findingId))).toHaveLength(2);
    expect(nextSteps.map((s) => s.findingId)).toContain('a');
    expect(nextSteps.map((s) => s.findingId)).not.toContain('d');
    // And by default the list is short: three steps.
    expect(p.prioritize(findings, rubric).nextSteps).toHaveLength(3);
  });

  it('never leads with a finding the AI has disputed', () => {
    const disputed = { ...ruleFinding({ id: 'x', severity: 'critical' }), disputedReason: 'does not apply' };
    const { nextSteps } = p.prioritize([disputed, ruleFinding({ id: 'y', severity: 'minor' })], rubric);
    expect(nextSteps.map((s) => s.findingId)).toEqual(['y']);
  });

  it('uses the suggestion as the action, falling back to the detail', () => {
    const f = ruleFinding({ id: 'a' });
    const { suggestion: _s, ...noSuggestion } = ruleFinding({ id: 'b' });
    const { nextSteps } = p.prioritize([f, noSuggestion], rubric);
    expect(nextSteps.find((s) => s.findingId === 'a')!.action).toBe('do this');
    expect(nextSteps.find((s) => s.findingId === 'b')!.action).toBe('detail');
  });
});

describe('ReportAssembler', () => {
  const assembler = new ReportAssembler();
  const now = new Date('2026-01-01T00:00:00Z');
  const okRun = (id: string, kind: 'deterministic' | 'ai') => ({ evaluatorId: id, kind, label: id, status: 'ok' as const, durationMs: 1, attempts: 1 });

  it('applies AI disputes to rule findings but never to critical ones', () => {
    const report = assembler.assemble({
      rubric,
      provisional: false,
      expectedEvaluators: 2,
      now,
      runs: [okRun('rules', 'deterministic'), okRun('ai', 'ai')],
      outputs: [
        { evaluator: rules, result: result({ findings: [ruleFinding({ id: 'god', severity: 'major' }), ruleFinding({ id: 'tiny', severity: 'critical' })] }) },
        { evaluator: ai, result: result({ disputes: [{ findingId: 'god', reason: 'facade' }, { findingId: 'tiny', reason: 'nah' }, { findingId: 'ghost', reason: 'n/a' }] }) },
      ],
    });
    expect(report.findings.find((f) => f.id === 'god')!.disputedReason).toBe('facade');
    expect(report.findings.find((f) => f.id === 'tiny')!.disputedReason).toBeUndefined();
    expect(report.complete).toBe(true);
  });

  it('is incomplete when an expected evaluator did not run, or when provisional', () => {
    const base = { rubric, expectedEvaluators: 2, now, outputs: [{ evaluator: rules, result: result() }], runs: [okRun('rules', 'deterministic')] };
    expect(assembler.assemble({ ...base, provisional: false }).complete).toBe(false);
    expect(assembler.assemble({ ...base, expectedEvaluators: 1, provisional: true }).complete).toBe(false);
    expect(assembler.assemble({ ...base, expectedEvaluators: 1, provisional: false }).complete).toBe(true);
  });

  it('keeps the first finding when two evaluators emit the same id, and de-duplicates alternatives and questions', () => {
    const report = assembler.assemble({
      rubric, provisional: false, expectedEvaluators: 2, now,
      runs: [okRun('rules', 'deterministic'), okRun('ai', 'ai')],
      outputs: [
        { evaluator: rules, result: result({ findings: [ruleFinding({ id: 'same', title: 'from rules' })] }) },
        { evaluator: ai, result: result({ findings: [ruleFinding({ id: 'same', title: 'from ai' })], alternatives: [{ observation: 'A', whyValid: 'v', tradeoff: 't' }, { observation: 'a', whyValid: 'v', tradeoff: 't' }], reflectionQuestions: ['1', '2', '3', '4'] }) },
      ],
    });
    expect(report.findings.filter((f) => f.id === 'same')).toHaveLength(1);
    expect(report.findings.find((f) => f.id === 'same')!.title).toBe('from rules');
    expect(report.alternatives).toHaveLength(1);
    expect(report.reflectionQuestions).toHaveLength(3);
  });
});
