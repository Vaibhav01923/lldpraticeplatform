import type { AlternativeNoteDto, DimensionId, EvidenceDto, FindingDto } from '../../../../shared/contracts';
import { DIMENSION_IDS } from '../../../../shared/contracts';
import type { DesignModel } from '../../domain/design/DesignModel';
import { finding } from '../../domain/evaluation/Finding';
import { clamp, round1 } from '../../domain/evaluation/Rubric';
import { clip } from '../../domain/text';
import type { DimensionAssessment, Dispute, EvaluatorResult } from '../Evaluator';
import type { RawReview } from './reviewSchema';

const LIMITS = { findings: 6, strengths: 3, alternatives: 3, questions: 3, disputes: 5, title: 140, detail: 600, suggestion: 400, summary: 600, rationale: 300 } as const;

export interface SanitizeContext {
  model: DesignModel;
  /** The rule findings the reviewer was shown, keyed by id. Disputes may only target these. */
  ruleFindings: readonly FindingDto[];
}

/**
 * Nothing the model says reaches the learner or the score without passing through here.
 *
 * The important job is the anti-hallucination guard: a finding is only as credible as its evidence, and
 * evidence is checkable. Every class a finding cites must exist in the learner's design; citations that do
 * not are dropped, and a design-level finding left with no valid evidence is demoted to a low-confidence
 * minor note rather than delivered as a confident accusation. Scores are clamped, text is bounded,
 * duplicate and unknown-dimension entries are discarded, and disputes may only target real rule findings.
 */
export function sanitizeReview(raw: RawReview, ctx: SanitizeContext): EvaluatorResult {
  const known = new Set<string>(DIMENSION_IDS);
  const isDim = (d: string): d is DimensionId => known.has(d);

  const seenDims = new Set<string>();
  const assessments: DimensionAssessment[] = [];
  for (const a of raw.assessments) {
    if (!isDim(a.dimension) || seenDims.has(a.dimension) || !Number.isFinite(a.score)) continue;
    seenDims.add(a.dimension);
    assessments.push({
      dimension: a.dimension,
      score: round1(clamp(a.score, 0, 4)),
      confidence: 0.8,
      rationale: a.rationale.trim() ? [clip(a.rationale.trim(), LIMITS.rationale)] : [],
    });
  }

  const usedIds = new Set<string>();
  const uniqueId = (dimension: string, title: string): string => {
    const base = `ai:${dimension}:${slug(title)}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };

  const findings: FindingDto[] = [];

  for (const f of raw.findings.slice(0, LIMITS.findings)) {
    if (!isDim(f.dimension) || !f.title.trim() || !f.detail.trim()) continue;
    const { valid, dropped } = verifyEvidence(f.evidenceClasses, ctx.model);
    // Structural claims need at least one real class behind them. Write-up claims (communication, requirements) can stand without.
    const needsClass = f.dimension === 'responsibilities' || f.dimension === 'abstractions';
    const unsupported = needsClass && valid.length === 0;
    const demoted = unsupported || dropped.length > 0;

    findings.push({
      ...finding({
        ruleId: `ai:${f.dimension}`,
        dimension: f.dimension,
        severity: unsupported ? 'minor' : f.severity,
        title: clip(f.title.trim(), LIMITS.title),
        detail: clip(f.detail.trim(), LIMITS.detail),
        suggestion: f.suggestion.trim() ? clip(f.suggestion.trim(), LIMITS.suggestion) : undefined,
        evidence: valid,
        source: 'ai',
        confidence: demoted ? 'low' : f.confidence,
      }),
      id: uniqueId(f.dimension, f.title),
    });
  }

  for (const s of raw.strengths.slice(0, LIMITS.strengths)) {
    if (!isDim(s.dimension) || !s.title.trim()) continue;
    const { valid } = verifyEvidence(s.evidenceClasses, ctx.model);
    findings.push({
      ...finding({
        ruleId: `ai:${s.dimension}`,
        dimension: s.dimension,
        severity: 'strength',
        title: clip(s.title.trim(), LIMITS.title),
        detail: clip(s.detail.trim(), LIMITS.detail),
        evidence: valid,
        source: 'ai',
        confidence: valid.length > 0 ? 'medium' : 'low',
      }),
      id: uniqueId(s.dimension, s.title),
    });
  }

  const targets = new Map(ctx.ruleFindings.map((f) => [f.id, f]));
  const disputes: Dispute[] = [];
  for (const d of raw.disputes.slice(0, LIMITS.disputes)) {
    const target = targets.get(d.findingId);
    if (target && target.severity !== 'critical' && d.reason.trim()) {
      disputes.push({ findingId: d.findingId, reason: clip(d.reason.trim(), LIMITS.detail) });
    }
  }

  const alternatives: AlternativeNoteDto[] = raw.alternatives
    .filter((a) => a.observation.trim() && a.whyValid.trim())
    .slice(0, LIMITS.alternatives)
    .map((a) => ({
      observation: clip(a.observation.trim(), LIMITS.detail),
      whyValid: clip(a.whyValid.trim(), LIMITS.detail),
      tradeoff: clip(a.tradeoff.trim(), LIMITS.detail),
    }));

  const summary = raw.summary.trim() ? clip(raw.summary.trim(), LIMITS.summary) : undefined;
  const reflectionQuestions = raw.reflectionQuestions
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, LIMITS.questions)
    .map((q) => clip(q, 240));

  return { assessments, findings, disputes, alternatives, ...(summary ? { summary } : {}), reflectionQuestions };
}

function verifyEvidence(claimed: readonly string[], model: DesignModel): { valid: EvidenceDto[]; dropped: string[] } {
  const valid: EvidenceDto[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const name of claimed) {
    const cls = model.find(name);
    if (!cls) {
      if (name.trim()) dropped.push(name);
    } else if (!seen.has(cls.name)) {
      seen.add(cls.name);
      valid.push({ kind: 'class', ref: cls.name });
    }
  }
  return { valid, dropped };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'note';
}
