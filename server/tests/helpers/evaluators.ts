import type { DimensionId, FindingDto } from '../../../shared/contracts';
import { DIMENSION_IDS } from '../../../shared/contracts';
import { finding } from '../../src/domain/evaluation/Finding';
import type { DimensionAssessment, EvaluationContext, Evaluator, EvaluatorResult } from '../../src/evaluation/Evaluator';

export const assessAll = (score: number, confidence = 0.7): DimensionAssessment[] =>
  DIMENSION_IDS.map((dimension) => ({ dimension, score, confidence, rationale: [`fixed ${score}`] }));

export const result = (over: Partial<EvaluatorResult> = {}): EvaluatorResult => ({ assessments: assessAll(3), findings: [], ...over });

export function fakeEvaluator(
  kind: 'deterministic' | 'ai',
  behaviour: (ctx: EvaluationContext, signal: AbortSignal, call: number) => Promise<EvaluatorResult> | EvaluatorResult,
  id = kind === 'ai' ? 'fake-ai' : 'fake-rules',
): Evaluator & { calls: number; seenContexts: EvaluationContext[] } {
  const ev = {
    id,
    label: id,
    kind,
    ...(kind === 'ai' ? { model: 'fake-model' } : {}),
    calls: 0,
    seenContexts: [] as EvaluationContext[],
    async evaluate(ctx: EvaluationContext, signal: AbortSignal) {
      ev.calls++;
      ev.seenContexts.push(ctx);
      return behaviour(ctx, signal, ev.calls);
    },
  };
  return ev;
}

export const ruleFinding = (over: { id?: string; dimension?: DimensionId; severity?: FindingDto['severity']; title?: string } = {}): FindingDto => ({
  ...finding({ ruleId: over.id ?? 'r', dimension: over.dimension ?? 'responsibilities', severity: over.severity ?? 'major', title: over.title ?? 'A problem', detail: 'detail', suggestion: 'do this' }),
});
