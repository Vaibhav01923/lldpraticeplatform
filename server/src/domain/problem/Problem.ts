import type {
  ApproachDto,
  ChangeScenarioDto,
  Difficulty,
  ProblemDto,
  ProblemSummaryDto,
  RequirementDto,
} from '../../../../shared/contracts';

/**
 * A capability the design must provide, expressed as vocabulary rather than as a class name.
 * `keywords` are the words a learner might use for the concept; any class named after (or
 * describing) one of them counts as covering it. That is how several different, valid designs
 * can all be recognised as covering "pricing".
 */
export interface Capability {
  id: string;
  label: string;
  requirementIds: string[];
  keywords: string[];
  /** Relative importance when computing coverage. Defaults to 1. */
  weight?: number;
  /**
   * For small concerns that are legitimately just a method on an existing class (reporting a count,
   * a door, a client id): being described inside another class is enough, and is not flagged as partial.
   */
  implicitOk?: boolean;
  /** Shown to the learner when the capability has no owner, without naming a class. */
  hint: string;
}

/**
 * Something that is expected to vary or grow (pricing rules, algorithms, payment methods).
 * A well-designed solution puts it behind an abstraction so a new variant is an addition,
 * not a modification (Open/Closed Principle).
 */
export interface VariabilityPoint {
  id: string;
  label: string;
  /** Why it varies: shown in feedback so the learner sees the reasoning, not just the verdict. */
  why: string;
  keywords: string[];
  /** Some concepts (vehicle type, coin denomination) are legitimately modelled as an enum. */
  accepts: 'abstraction' | 'abstraction-or-enum';
}

/** A "what if the requirement changes?" probe that the learner answers in prose. */
export interface ChangeScenario {
  id: string;
  prompt: string;
  /** Concepts a good answer is likely to touch; guidance for the AI reviewer, never shown as a checklist. */
  likelyConcepts: string[];
}

export interface ApproachNote extends ApproachDto {}

export interface ProblemProps {
  id: string;
  title: string;
  difficulty: Difficulty;
  tagline: string;
  tags: string[];
  estimatedMinutes: number;
  context: string;
  requirements: RequirementDto[];
  constraints: string[];
  outOfScope: string[];
  capabilities: Capability[];
  variabilityPoints: VariabilityPoint[];
  scenarios: ChangeScenario[];
  hints: string[];
  approaches: ApproachNote[];
}

/**
 * A practice problem: the brief the learner sees, plus the hidden evaluation knowledge
 * (capabilities, variability points) that lets the platform judge open-ended answers.
 * Immutable and self-validating so a bad catalogue entry fails at startup, not mid-evaluation.
 */
export class Problem {
  constructor(private readonly props: ProblemProps) {
    Problem.validate(props);
  }

  get id(): string {
    return this.props.id;
  }
  get title(): string {
    return this.props.title;
  }
  get difficulty(): Difficulty {
    return this.props.difficulty;
  }
  get requirements(): readonly RequirementDto[] {
    return this.props.requirements;
  }
  get constraints(): readonly string[] {
    return this.props.constraints;
  }
  get capabilities(): readonly Capability[] {
    return this.props.capabilities;
  }
  get variabilityPoints(): readonly VariabilityPoint[] {
    return this.props.variabilityPoints;
  }
  get scenarios(): readonly ChangeScenario[] {
    return this.props.scenarios;
  }
  get approaches(): readonly ApproachNote[] {
    return this.props.approaches;
  }

  requirement(id: string): RequirementDto | undefined {
    return this.props.requirements.find((r) => r.id === id);
  }
  scenario(id: string): ChangeScenario | undefined {
    return this.props.scenarios.find((s) => s.id === id);
  }

  /** What the learner sees before attempting: no keywords, no reference solutions. */
  toDto(): ProblemDto {
    const p = this.props;
    return {
      ...this.toSummary(),
      context: p.context,
      requirements: p.requirements.map((r) => ({ ...r })),
      constraints: [...p.constraints],
      outOfScope: [...p.outOfScope],
      scenarios: p.scenarios.map((s): ChangeScenarioDto => ({ id: s.id, prompt: s.prompt })),
      hints: [...p.hints],
    };
  }

  toSummary(): ProblemSummaryDto {
    const p = this.props;
    return {
      id: p.id,
      title: p.title,
      difficulty: p.difficulty,
      tagline: p.tagline,
      tags: [...p.tags],
      estimatedMinutes: p.estimatedMinutes,
    };
  }

  private static validate(p: ProblemProps): void {
    const fail = (msg: string): never => {
      throw new Error(`Problem '${p.id}': ${msg}`);
    };
    const unique = (label: string, ids: string[]) => {
      if (new Set(ids).size !== ids.length) fail(`duplicate ${label} ids`);
    };
    if (p.requirements.length === 0) fail('needs at least one requirement');
    unique('requirement', p.requirements.map((r) => r.id));
    unique('capability', p.capabilities.map((c) => c.id));
    unique('variability point', p.variabilityPoints.map((v) => v.id));
    unique('scenario', p.scenarios.map((s) => s.id));
    const reqIds = new Set(p.requirements.map((r) => r.id));
    for (const c of p.capabilities) {
      if (c.keywords.length === 0) fail(`capability '${c.id}' has no keywords`);
      for (const r of c.requirementIds) if (!reqIds.has(r)) fail(`capability '${c.id}' cites unknown requirement '${r}'`);
    }
    for (const v of p.variabilityPoints) if (v.keywords.length === 0) fail(`variability point '${v.id}' has no keywords`);
  }
}

/** Where problems come from. The prototype ships an in-code catalogue; a database or CMS could implement this too. */
export interface ProblemCatalog {
  list(): Problem[];
  get(id: string): Problem | undefined;
}

export class InMemoryProblemCatalog implements ProblemCatalog {
  private readonly byId: Map<string, Problem>;

  constructor(problems: Problem[]) {
    this.byId = new Map(problems.map((p) => [p.id, p]));
    if (this.byId.size !== problems.length) throw new Error('Duplicate problem ids in catalogue');
  }

  list(): Problem[] {
    return [...this.byId.values()];
  }
  get(id: string): Problem | undefined {
    return this.byId.get(id);
  }
}
