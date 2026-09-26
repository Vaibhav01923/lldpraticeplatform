import type { ComparisonDto, EvaluationReportDto, FindingDto, FindingRefDto } from '../../../shared/contracts';
import { round1 } from '../domain/evaluation/Rubric';

export interface ComparableAttempt {
  id: string;
  number: number;
  report: EvaluationReportDto;
}

const ref = (f: FindingDto): FindingRefDto => ({ id: f.id, title: f.title, dimension: f.dimension, severity: f.severity });

/**
 * "Did I actually improve?" Compares two evaluated attempts: score movement per dimension, and which
 * structural problems were fixed, are still there, or are new.
 *
 * Only rule findings are tracked, because their ids are stable (rule + subject), so "God class: ParkingLot"
 * in attempt 1 and attempt 2 is recognisably the same problem. AI findings are worded fresh each time and
 * cannot be matched reliably, so they are shown but not counted as fixed or persisting.
 */
export function compareAttempts(from: ComparableAttempt, to: ComparableAttempt): ComparisonDto {
  const tracked = (r: EvaluationReportDto) => new Map(r.findings.filter((f) => f.source === 'rules' && f.severity !== 'strength').map((f) => [f.id, f]));
  const before = tracked(from.report);
  const after = tracked(to.report);

  const dimensionDeltas = to.report.dimensions.map((d) => {
    const prev = from.report.dimensions.find((x) => x.dimension === d.dimension)?.score ?? 0;
    return { dimension: d.dimension, from: prev, to: d.score, delta: round1(d.score - prev) };
  });

  const usedAi = (r: EvaluationReportDto) => r.dimensions.some((d) => d.sources.includes('ai'));
  const caveat = usedAi(from.report) !== usedAi(to.report) ? 'One of these attempts had an AI review and the other did not, so the scores are not directly comparable. The tracked structural findings are.' : undefined;

  return {
    fromAttemptId: from.id,
    toAttemptId: to.id,
    fromNumber: from.number,
    toNumber: to.number,
    overallDelta: round1(to.report.overall - from.report.overall),
    dimensionDeltas,
    resolved: [...before.values()].filter((f) => !after.has(f.id)).map(ref),
    persisting: [...after.values()].filter((f) => before.has(f.id)).map(ref),
    introduced: [...after.values()].filter((f) => !before.has(f.id)).map(ref),
    ...(caveat ? { caveat } : {}),
  };
}
