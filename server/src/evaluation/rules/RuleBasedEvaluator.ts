import { DIMENSION_IDS, type DimensionId, type FindingDto } from '../../../../shared/contracts';
import { ConceptMatcher } from '../../domain/design/ConceptMatcher';
import { clamp, round1 } from '../../domain/evaluation/Rubric';
import type { DimensionAssessment, EvaluationContext, Evaluator, EvaluatorResult, ScoreCap } from '../Evaluator';
import type { Criterion, DesignRule } from './DesignRule';
import { CapabilityCoverageRule } from './coverage';
import { AbstractionUsageRule, DependencyOnConcretionRule, InheritanceDepthRule, IsolatedClassRule, UsageCyclesRule } from './abstractions';
import { AssumptionsRule, TradeoffsRule } from './communication';
import { ChangeScenarioRule, VariabilityRule } from './extensibility';
import { DesignSizeRule, GodClassRule, ResponsibilitiesStatedRule, VagueNamesRule } from './responsibilities';

/** The rules this build ships with, in the order their findings are produced. */
export function defaultRules(): DesignRule[] {
  return [
    new DesignSizeRule(),
    new CapabilityCoverageRule(),
    new ResponsibilitiesStatedRule(),
    new GodClassRule(),
    new VagueNamesRule(),
    new IsolatedClassRule(),
    new AbstractionUsageRule(),
    new InheritanceDepthRule(),
    new DependencyOnConcretionRule(),
    new UsageCyclesRule(),
    new VariabilityRule(),
    new ChangeScenarioRule(),
    new AssumptionsRule(),
    new TradeoffsRule(),
  ];
}

/**
 * The deterministic evaluator: runs a list of independent rules and turns their criteria into
 * per-dimension scores. Same input, same output, no network: it is what gives the learner instant,
 * reproducible feedback even when the AI stage is slow or down.
 */
export class RuleBasedEvaluator implements Evaluator {
  readonly id = 'rules';
  readonly label = 'Structural checks';
  readonly kind = 'deterministic' as const;

  constructor(private readonly rules: readonly DesignRule[] = defaultRules()) {}

  async evaluate(ctx: EvaluationContext): Promise<EvaluatorResult> {
    const model = ctx.submission.model;
    const ruleCtx = { problem: ctx.problem, submission: ctx.submission, model, matcher: new ConceptMatcher(model) };

    const findings: FindingDto[] = [];
    const criteria: Criterion[] = [];
    const caps: ScoreCap[] = [];
    let coverage: EvaluatorResult['coverage'];
    for (const rule of this.rules) {
      const out = rule.evaluate(ruleCtx);
      findings.push(...out.findings);
      criteria.push(...out.criteria);
      caps.push(...(out.caps ?? []));
      coverage = out.coverage ?? coverage;
    }

    const assessments = DIMENSION_IDS.flatMap((dim) => {
      const own = criteria.filter((c) => c.dimension === dim);
      return own.length > 0 ? [assess(dim, own)] : [];
    });
    return { assessments, findings, caps, ...(coverage ? { coverage } : {}) };
  }
}

function assess(dimension: DimensionId, criteria: Criterion[]): DimensionAssessment {
  const weight = criteria.reduce((s, c) => s + c.weight, 0);
  const score = criteria.reduce((s, c) => s + c.weight * c.score, 0) / weight;
  const shortfall = (c: Criterion) => c.weight * (4 - c.score);
  const failing = criteria.filter((c) => c.score < 4).sort((a, b) => shortfall(b) - shortfall(a));
  const passing = criteria.filter((c) => c.score >= 4);
  return {
    dimension,
    score: round1(clamp(score, 0, 4)),
    confidence: weight >= 2 ? 0.7 : 0.5,
    rationale: [...failing.map((c) => `${c.label}: ${c.reason}`), ...passing.slice(0, 2).map((c) => `✓ ${c.reason}`)],
  };
}
