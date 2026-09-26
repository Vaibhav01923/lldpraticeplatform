import { z } from 'zod';

/**
 * The shape the AI reviewer must return. Deliberately plain (strings, enums, arrays, one number): only
 * constructs that structured-output APIs support, so the model's reply is constrained at generation time.
 * Length and range limits are enforced afterwards in the sanitizer, where a violation can be repaired
 * (truncated, clamped) instead of failing the whole review.
 */
const Dimension = z.enum(['requirements', 'responsibilities', 'abstractions', 'extensibility', 'communication']);
const Confidence = z.enum(['high', 'medium', 'low']);

export const RawReviewSchema = z.object({
  assessments: z.array(z.object({ dimension: Dimension, score: z.number(), rationale: z.string() })),
  findings: z.array(
    z.object({
      dimension: Dimension,
      severity: z.enum(['major', 'minor']),
      title: z.string(),
      detail: z.string(),
      suggestion: z.string(),
      evidenceClasses: z.array(z.string()),
      confidence: Confidence,
    }),
  ),
  strengths: z.array(z.object({ dimension: Dimension, title: z.string(), detail: z.string(), evidenceClasses: z.array(z.string()) })),
  disputes: z.array(z.object({ findingId: z.string(), reason: z.string() })),
  alternatives: z.array(z.object({ observation: z.string(), whyValid: z.string(), tradeoff: z.string() })),
  summary: z.string(),
  reflectionQuestions: z.array(z.string()),
});

export type RawReview = z.infer<typeof RawReviewSchema>;

/** JSON Schema for the request's structured-output constraint: every object closed, nothing unsupported. */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>;
  delete json['$schema'];
  const close = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(close);
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (obj['type'] === 'object') {
        obj['additionalProperties'] = false;
        if (obj['properties']) obj['required'] = Object.keys(obj['properties'] as object);
      }
      Object.values(obj).forEach(close);
    }
  };
  close(json);
  return json;
}

export const REVIEW_JSON_SCHEMA = strictJsonSchema(RawReviewSchema);
