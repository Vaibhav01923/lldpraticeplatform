import type { Confidence, DimensionId, EvidenceDto, FindingDto, FindingSource, Severity } from '../../../../shared/contracts';

export interface FindingInput {
  ruleId: string;
  /**
   * What the finding is about (a class, a capability). Part of the id, so the same problem on the same
   * subject keeps the same id from one attempt to the next and can be tracked as fixed or persisting.
   */
  subject?: string;
  dimension: DimensionId;
  severity: Severity;
  title: string;
  detail: string;
  suggestion?: string;
  evidence?: EvidenceDto[];
  source?: FindingSource;
  confidence?: Confidence;
}

export function finding(input: FindingInput): FindingDto {
  return {
    id: input.subject ? `${input.ruleId}:${input.subject}` : input.ruleId,
    ruleId: input.ruleId,
    dimension: input.dimension,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    ...(input.suggestion ? { suggestion: input.suggestion } : {}),
    evidence: input.evidence ?? [],
    source: input.source ?? 'rules',
    confidence: input.confidence ?? 'medium',
  };
}

export const classEvidence = (name: string, note?: string): EvidenceDto => ({ kind: 'class', ref: name, ...(note ? { note } : {}) });
export const relationshipEvidence = (ref: string, note?: string): EvidenceDto => ({ kind: 'relationship', ref, ...(note ? { note } : {}) });
export const requirementEvidence = (ref: string): EvidenceDto => ({ kind: 'requirement', ref });
export const capabilityEvidence = (ref: string): EvidenceDto => ({ kind: 'capability', ref });
export const scenarioEvidence = (ref: string): EvidenceDto => ({ kind: 'scenario', ref });
export const textEvidence = (ref: string, note?: string): EvidenceDto => ({ kind: 'text', ref, ...(note ? { note } : {}) });
