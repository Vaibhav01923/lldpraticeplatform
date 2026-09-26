import type { CapabilityCoverageDto, DimensionId, FindingDto } from '../../../../shared/contracts';
import type { Submission } from '../../domain/attempt/Submission';
import type { ConceptMatcher } from '../../domain/design/ConceptMatcher';
import type { DesignModel } from '../../domain/design/DesignModel';
import type { Problem } from '../../domain/problem/Problem';
import type { ScoreCap } from '../Evaluator';

/**
 * One line of the rubric, scored. Every rule reports the criteria it examined, including the ones that
 * passed, so a dimension's score is always a transparent weighted average of named things.
 */
export interface Criterion {
  dimension: DimensionId;
  id: string;
  label: string;
  /** 0–4. */
  score: number;
  /** Relative importance within its dimension. */
  weight: number;
  /** One short sentence saying why the score is what it is. */
  reason: string;
}

export interface RuleOutcome {
  findings: FindingDto[];
  criteria: Criterion[];
  caps?: ScoreCap[];
  coverage?: CapabilityCoverageDto[];
}

export interface RuleContext {
  problem: Problem;
  submission: Submission;
  model: DesignModel;
  matcher: ConceptMatcher;
}

/** A single, independent, explainable check. New checks are added by writing one of these. */
export interface DesignRule {
  readonly id: string;
  evaluate(ctx: RuleContext): RuleOutcome;
}

export const EMPTY_OUTCOME: RuleOutcome = { findings: [], criteria: [] };

export const clampScore = (n: number): number => Math.min(4, Math.max(0, n));
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export const nameList = (names: readonly string[], max = 4): string =>
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
