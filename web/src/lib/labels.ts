import type { AttemptStatus, ClassKind, Confidence, RelationKind, Severity } from '../../../shared/contracts';

export const KIND_LABELS: Record<ClassKind, string> = { class: 'Class', interface: 'Interface', abstract: 'Abstract class', enum: 'Enum' };

export const RELATION_LABELS: Record<RelationKind, string> = {
  inheritance: 'extends',
  realization: 'implements',
  composition: 'owns (composition)',
  aggregation: 'has (aggregation)',
  association: 'uses (association)',
  dependency: 'depends on',
};

export const RELATION_HELP: Record<RelationKind, string> = {
  inheritance: 'A is a kind of B (subclass extends parent).',
  realization: 'A implements the interface B.',
  composition: 'A owns B; B cannot outlive A (a Level owns its Spots).',
  aggregation: 'A holds B, but B can exist on its own.',
  association: 'A keeps a reference to B and collaborates with it over time.',
  dependency: 'A uses B briefly (a parameter or a local), without keeping it.',
};

export const SEVERITY_LABELS: Record<Severity, string> = { critical: 'Critical', major: 'Important', minor: 'Worth a look', strength: 'Strength' };
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2, strength: 3 };

export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

export const STATUS_LABELS: Record<AttemptStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Queued',
  EVALUATING: 'Evaluating',
  EVALUATED: 'Evaluated',
  PARTIALLY_EVALUATED: 'Partly evaluated',
  EVALUATION_FAILED: 'Evaluation failed',
};

export const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;

export function formatDelta(delta: number): string {
  if (delta === 0) return '±0';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`;
}

export function formatWhen(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function bandTone(band: string | undefined): 'bad' | 'warn' | 'good' | 'info' | 'muted' {
  switch (band) {
    case 'Strong': return 'good';
    case 'Solid': return 'info';
    case 'Developing': return 'warn';
    case 'Weak':
    case 'Not yet': return 'bad';
    default: return 'muted';
  }
}
