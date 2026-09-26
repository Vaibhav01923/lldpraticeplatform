import type { AlternativeNoteDto, EvaluationReportDto, EvaluatorRunDto, FindingDto } from '../../../shared/contracts';
import type { Rubric } from '../domain/evaluation/Rubric';
import { FeedbackPrioritizer } from './FeedbackPrioritizer';
import { ScoreAggregator, type EvaluatorOutput } from './ScoreAggregator';

export interface AssembleInput {
  rubric: Rubric;
  /** Only evaluators that succeeded. */
  outputs: readonly EvaluatorOutput[];
  /** One entry per evaluator that was attempted, successful or not. */
  runs: readonly EvaluatorRunDto[];
  /** True when slower evaluators are still running. */
  provisional: boolean;
  /** How many evaluators the pipeline is configured with. */
  expectedEvaluators: number;
  now: Date;
}

/** Combines whatever the evaluators produced into the single report the learner sees. */
export class ReportAssembler {
  constructor(
    private readonly aggregator = new ScoreAggregator(),
    private readonly prioritizer = new FeedbackPrioritizer(),
  ) {}

  assemble(input: AssembleInput): EvaluationReportDto {
    const { rubric, outputs, runs } = input;
    const { dimensions, overall, band } = this.aggregator.aggregate(rubric, outputs);

    // Merge findings; if two evaluators report the same id, the first one (deterministic) wins.
    const byId = new Map<string, FindingDto>();
    for (const f of outputs.flatMap((o) => o.result.findings)) if (!byId.has(f.id)) byId.set(f.id, { ...f });

    // The AI reviewer may argue that a heuristic finding does not apply. Critical findings are factual and cannot be disputed.
    for (const d of outputs.flatMap((o) => o.result.disputes ?? [])) {
      const target = byId.get(d.findingId);
      if (target && target.source === 'rules' && target.severity !== 'critical') target.disputedReason = d.reason;
    }

    const { ordered, nextSteps } = this.prioritizer.prioritize([...byId.values()], rubric);

    const coverage = outputs.map((o) => o.result.coverage).find((c) => c !== undefined) ?? [];
    const alternatives = dedupeAlternatives(outputs.flatMap((o) => o.result.alternatives ?? []));
    const summary = outputs.map((o) => o.result.summary).find((s) => s);
    const reflectionQuestions = outputs.flatMap((o) => o.result.reflectionQuestions ?? []).slice(0, 3);

    return {
      provisional: input.provisional,
      complete: !input.provisional && runs.length === input.expectedEvaluators && runs.every((r) => r.status === 'ok'),
      overall,
      band,
      dimensions,
      findings: ordered,
      nextSteps,
      coverage,
      alternatives,
      ...(summary ? { summary } : {}),
      reflectionQuestions,
      runs: [...runs],
      generatedAt: input.now.toISOString(),
    };
  }
}

function dedupeAlternatives(items: AlternativeNoteDto[]): AlternativeNoteDto[] {
  const seen = new Set<string>();
  return items.filter((a) => {
    const key = a.observation.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
