import { DIMENSION_IDS, type DimensionId } from '../../../../shared/contracts';

export interface RubricDimension {
  id: DimensionId;
  label: string;
  /** The question this dimension asks of a design. */
  question: string;
  /** Share of the overall score. Weights sum to 1. */
  weight: number;
  /** What a score of 0..4 looks like, from "nothing" to "strong". */
  levels: readonly [string, string, string, string, string];
}

/**
 * What "good" means, independent of any particular solution.
 *
 * The rubric is deliberately about principles (ownership, cohesion, abstraction, change, communication)
 * rather than about matching a reference design, so that different valid designs can score equally well.
 * It is shared by the deterministic rules (which turn it into checks) and the AI reviewer (which receives it
 * verbatim), so both are judging against the same yardstick.
 */
export class Rubric {
  static readonly standard = new Rubric([
    {
      id: 'requirements',
      label: 'Requirements coverage',
      question: 'Does every requirement have a clear owner in the design?',
      weight: 0.25,
      levels: [
        'Little of the problem is represented.',
        'Several requirements have no owner in the design.',
        'The main flow is covered; some requirements are missing or only implied.',
        'All core requirements have an owner; failure and edge cases are partly handled.',
        'Every requirement, including failure and edge cases, has a clear owner.',
      ],
    },
    {
      id: 'responsibilities',
      label: 'Responsibility assignment',
      question: 'Does each class have one clear job, with behaviour living next to the data it needs?',
      weight: 0.25,
      levels: [
        'Classes are unnamed bags of data, or one class does everything.',
        'Responsibilities are unclear or several classes are overloaded.',
        'Most classes have a job, but some do too much or too little.',
        'Each class has a clear, mostly single responsibility.',
        'Every class has one crisp job, and behaviour is placed where the data lives.',
      ],
    },
    {
      id: 'abstractions',
      label: 'Abstractions & relationships',
      question: 'Are interfaces, inheritance and associations used deliberately, with dependencies pointing at abstractions?',
      weight: 0.2,
      levels: [
        'Relationships are missing or contradictory.',
        'Relationships exist but abstractions are missing, dead or misused.',
        'Reasonable structure, with some concrete coupling or unnecessary hierarchy.',
        'Deliberate abstractions and sensible relationship kinds; little coupling to concretions.',
        'Abstractions sit exactly where variation is, dependencies point at them, and nothing is over-built.',
      ],
    },
    {
      id: 'extensibility',
      label: 'Extensibility',
      question: 'Can the things that will change be changed by adding code rather than editing it?',
      weight: 0.2,
      levels: [
        'Any change would rewrite the core.',
        'Changes would touch many existing classes.',
        'Some variation points are isolated; others would require edits.',
        'Most likely changes are absorbed by adding classes; the answers to change scenarios hold up.',
        'Likely changes are additions; the learner can show precisely what stays untouched.',
      ],
    },
    {
      id: 'communication',
      label: 'Assumptions & trade-offs',
      question: 'Are assumptions stated, choices explained, and alternatives named?',
      weight: 0.1,
      levels: [
        'No assumptions or reasoning are given.',
        'Choices are listed without reasons.',
        'Some assumptions and reasons, thin on alternatives.',
        'Clear assumptions and reasons for the main choices.',
        'Assumptions, reasons and rejected alternatives are all explicit.',
      ],
    },
  ]);

  private readonly byId: Map<DimensionId, RubricDimension>;

  constructor(readonly dimensions: readonly RubricDimension[]) {
    const total = dimensions.reduce((s, d) => s + d.weight, 0);
    if (Math.abs(total - 1) > 1e-9) throw new Error(`Rubric weights must sum to 1 (got ${total})`);
    if (dimensions.length !== DIMENSION_IDS.length) throw new Error('Rubric must define every dimension');
    this.byId = new Map(dimensions.map((d) => [d.id, d]));
  }

  dimension(id: DimensionId): RubricDimension {
    const d = this.byId.get(id);
    if (!d) throw new Error(`Unknown dimension '${id}'`);
    return d;
  }

  overall(scores: Partial<Record<DimensionId, number>>): number {
    const sum = this.dimensions.reduce((s, d) => s + d.weight * (scores[d.id] ?? 0), 0);
    return round1(sum);
  }

  static band(score: number): string {
    if (score < 0.5) return 'Not yet';
    if (score < 1.5) return 'Weak';
    if (score < 2.5) return 'Developing';
    if (score < 3.5) return 'Solid';
    return 'Strong';
  }
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
