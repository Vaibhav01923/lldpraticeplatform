import { describe, it, expect } from 'vitest';
import { compareAttempts } from '../../src/application/AttemptComparison';
import { finding } from '../../src/domain/evaluation/Finding';
import type { EvaluationReportDto } from '../../../shared/contracts';

const report = (over: Partial<EvaluationReportDto>): EvaluationReportDto => ({
  provisional: false, complete: true, overall: 2, band: 'Developing', dimensions: [{ dimension: 'requirements', label: 'R', score: 2, band: 'Developing', rationale: [], caps: [], sources: ['rules'] }],
  findings: [], nextSteps: [], coverage: [], alternatives: [], reflectionQuestions: [], runs: [], generatedAt: '2026-01-01T00:00:00Z', ...over,
});
const f = (ruleId: string, subject?: string, source: 'rules' | 'ai' = 'rules', severity: 'major' | 'strength' = 'major') =>
  finding({ ruleId, subject, dimension: 'responsibilities', severity, title: `${ruleId} ${subject ?? ''}`, detail: 'd', source });

describe('compareAttempts', () => {
  it('classifies structural findings as resolved, persisting or introduced, and reports deltas', () => {
    const from = { id: 'a1', number: 1, report: report({ overall: 2, findings: [f('god-class', 'Manager'), f('vague-names'), f('mutual-dependency', 'A+B')] }) };
    const to = { id: 'a2', number: 2, report: report({ overall: 3.2, dimensions: [{ dimension: 'requirements', label: 'R', score: 3.4, band: 'Solid', rationale: [], caps: [], sources: ['rules'] }], findings: [f('vague-names'), f('dead-abstraction', 'Notifier')] }) };
    const c = compareAttempts(from, to);
    expect(c.overallDelta).toBe(1.2);
    expect(c.dimensionDeltas).toEqual([{ dimension: 'requirements', from: 2, to: 3.4, delta: 1.4 }]);
    expect(c.resolved.map((x) => x.id)).toEqual(['god-class:Manager', 'mutual-dependency:A+B']);
    expect(c.persisting.map((x) => x.id)).toEqual(['vague-names']);
    expect(c.introduced.map((x) => x.id)).toEqual(['dead-abstraction:Notifier']);
  });

  it('ignores strengths and AI findings, whose wording changes every time', () => {
    const from = { id: 'a1', number: 1, report: report({ findings: [f('good', undefined, 'rules', 'strength'), f('ai:x', 'v1', 'ai')] }) };
    const to = { id: 'a2', number: 2, report: report({ findings: [f('ai:x', 'v2', 'ai')] }) };
    const c = compareAttempts(from, to);
    expect([c.resolved, c.persisting, c.introduced]).toEqual([[], [], []]);
  });

  it('warns when one attempt had an AI review and the other did not', () => {
    const withAi = report({ dimensions: [{ dimension: 'requirements', label: 'R', score: 3, band: 'Solid', rationale: [], caps: [], sources: ['rules', 'ai'] }] });
    expect(compareAttempts({ id: 'a', number: 1, report: report({}) }, { id: 'b', number: 2, report: withAi }).caveat).toMatch(/not directly comparable/);
    expect(compareAttempts({ id: 'a', number: 1, report: withAi }, { id: 'b', number: 2, report: withAi }).caveat).toBeUndefined();
  });
});
