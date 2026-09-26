import type { ClassKind, DesignModelDto, ParseIssueDto, RelationKind } from '../../../../shared/contracts';
import { ClassSpec, CLASS_KINDS } from './ClassSpec';
import { Relationship, RELATION_KINDS } from './Relationship';

export const DESIGN_LIMITS = {
  maxClasses: 40,
  maxRelationships: 120,
  maxMembersPerClass: 30,
  maxNameLength: 60,
  maxResponsibilityLength: 400,
  maxMemberLength: 160,
  maxLabelLength: 80,
} as const;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ClassInput {
  name: string;
  kind?: ClassKind;
  responsibility?: string;
  attributes?: string[];
  methods?: string[];
}
export interface RelationshipInput {
  from: string;
  to: string;
  kind: RelationKind;
  label?: string;
}
export interface BuildResult {
  /** Present only when there are no error-level issues. */
  model?: DesignModel;
  issues: ParseIssueDto[];
}

/**
 * The format-independent representation of a learner's design.
 *
 * Every SubmissionFormat (CRC cards, Mermaid, and whatever comes next) parses into this,
 * and every Evaluator reads only this. That single seam is what lets a new input format or
 * a new evaluator be added without touching the other side.
 *
 * Invariants enforced by `build`: unique class names, valid identifiers, relationships that
 * point at declared classes, no self-inheritance, no inheritance cycles, size limits.
 */
export class DesignModel {
  private readonly byName: Map<string, ClassSpec>;

  private constructor(
    private readonly classList: readonly ClassSpec[],
    private readonly relList: readonly Relationship[],
  ) {
    this.byName = new Map(classList.map((c) => [c.name.toLowerCase(), c]));
  }

  // ── construction ─────────────────────────────────────────────────────────

  static build(input: { classes: ClassInput[]; relationships: RelationshipInput[] }): BuildResult {
    const issues: ParseIssueDto[] = [];
    const error = (message: string, location?: string) =>
      issues.push({ severity: 'error', message, ...(location ? { location } : {}) });

    if (input.classes.length === 0) error('Add at least one class to your design.');
    if (input.classes.length > DESIGN_LIMITS.maxClasses)
      error(`A design can have at most ${DESIGN_LIMITS.maxClasses} classes; this one has ${input.classes.length}.`);
    if (input.relationships.length > DESIGN_LIMITS.maxRelationships)
      error(`A design can have at most ${DESIGN_LIMITS.maxRelationships} relationships.`);
    if (issues.length > 0) return { issues };

    const classes: ClassSpec[] = [];
    const seen = new Set<string>();
    for (const raw of input.classes) {
      const name = (raw.name ?? '').trim();
      if (!IDENTIFIER.test(name) || name.length > DESIGN_LIMITS.maxNameLength) {
        error(`'${name || '(empty)'}' is not a valid class name. Use letters, digits and underscores, e.g. ParkingLot.`, name);
        continue;
      }
      if (seen.has(name.toLowerCase())) {
        error(`Class '${name}' is declared more than once.`, name);
        continue;
      }
      seen.add(name.toLowerCase());

      const kind = raw.kind ?? 'class';
      if (!CLASS_KINDS.includes(kind)) {
        error(`Class '${name}' has an unknown kind '${String(kind)}'.`, name);
        continue;
      }
      const spec = ClassSpec.create({ ...raw, name, kind });
      if (spec.responsibility.length > DESIGN_LIMITS.maxResponsibilityLength)
        error(`The responsibility of '${name}' is longer than ${DESIGN_LIMITS.maxResponsibilityLength} characters. A class should have one crisp responsibility.`, name);
      if (spec.attributes.length > DESIGN_LIMITS.maxMembersPerClass || spec.methods.length > DESIGN_LIMITS.maxMembersPerClass)
        error(`'${name}' lists more than ${DESIGN_LIMITS.maxMembersPerClass} attributes or methods.`, name);
      if ([...spec.attributes, ...spec.methods].some((m) => m.length > DESIGN_LIMITS.maxMemberLength))
        error(`A member of '${name}' is longer than ${DESIGN_LIMITS.maxMemberLength} characters.`, name);
      classes.push(spec);
    }

    const relationships: Relationship[] = [];
    const seenRel = new Set<string>();
    for (const raw of input.relationships) {
      const from = (raw.from ?? '').trim();
      const to = (raw.to ?? '').trim();
      const label = (raw.label ?? '').trim();
      const where = `${from} → ${to}`;
      if (!RELATION_KINDS.includes(raw.kind)) {
        error(`Relationship ${where} has an unknown kind '${String(raw.kind)}'.`, where);
        continue;
      }
      if (!seen.has(from.toLowerCase())) {
        error(`Relationship ${where} refers to '${from}', which is not a class in your design.`, where);
        continue;
      }
      if (!seen.has(to.toLowerCase())) {
        error(`Relationship ${where} refers to '${to}', which is not a class in your design.`, where);
        continue;
      }
      if (from.toLowerCase() === to.toLowerCase() && (raw.kind === 'inheritance' || raw.kind === 'realization')) {
        error(`'${from}' cannot ${raw.kind === 'inheritance' ? 'extend' : 'implement'} itself.`, where);
        continue;
      }
      if (label.length > DESIGN_LIMITS.maxLabelLength) {
        error(`The label on ${where} is too long.`, where);
        continue;
      }
      const canonicalFrom = classes.find((c) => c.name.toLowerCase() === from.toLowerCase())!.name;
      const canonicalTo = classes.find((c) => c.name.toLowerCase() === to.toLowerCase())!.name;
      const key = `${canonicalFrom}|${canonicalTo}|${raw.kind}`;
      if (seenRel.has(key)) continue; // an exact repeat adds no information
      seenRel.add(key);
      relationships.push(new Relationship(canonicalFrom, canonicalTo, raw.kind, label));
    }

    if (issues.some((i) => i.severity === 'error')) return { issues };

    const model = new DesignModel(classes, relationships);
    const cycle = model.findInheritanceCycle();
    if (cycle) {
      error(`Inheritance cycle: ${cycle.join(' → ')}. A class cannot be its own ancestor.`, cycle[0]);
      return { issues };
    }
    return { model, issues };
  }

  /** Rehydrate a model that was already validated (e.g. from a stored submission). */
  static fromDto(dto: DesignModelDto): DesignModel {
    const { model, issues } = DesignModel.build(dto);
    if (!model) throw new Error(`Stored design model is invalid: ${issues.map((i) => i.message).join('; ')}`);
    return model;
  }

  // ── queries ──────────────────────────────────────────────────────────────

  get classes(): readonly ClassSpec[] {
    return this.classList;
  }
  get relationships(): readonly Relationship[] {
    return this.relList;
  }

  find(name: string): ClassSpec | undefined {
    return this.byName.get(name.trim().toLowerCase());
  }
  has(name: string): boolean {
    return this.byName.has(name.trim().toLowerCase());
  }

  /** Direct parents/interfaces of a class. */
  supertypesOf(name: string): ClassSpec[] {
    return this.related(this.relList.filter((r) => r.isStructural && eq(r.from, name)).map((r) => r.to));
  }
  /** Direct children/implementors of a class. */
  subtypesOf(name: string): ClassSpec[] {
    return this.related(this.relList.filter((r) => r.isStructural && eq(r.to, name)).map((r) => r.from));
  }
  /** Classes that `name` uses, owns or holds (non-structural, outgoing). */
  collaboratorsOf(name: string): ClassSpec[] {
    return this.related(this.relList.filter((r) => r.isUsage && eq(r.from, name)).map((r) => r.to));
  }
  /** Classes that use `name` (non-structural, incoming). */
  clientsOf(name: string): ClassSpec[] {
    return this.related(this.relList.filter((r) => r.isUsage && eq(r.to, name)).map((r) => r.from));
  }
  /** Outgoing relationships of any kind. */
  outgoing(name: string): Relationship[] {
    return this.relList.filter((r) => eq(r.from, name));
  }
  /** Number of relationships touching a class, in either direction. */
  degree(name: string): number {
    return this.relList.filter((r) => r.involves(name)).length;
  }

  /** Length of the longest inheritance chain above a class (0 = no parent). */
  inheritanceDepth(name: string): number {
    const visit = (n: string, guard: Set<string>): number => {
      if (guard.has(n.toLowerCase())) return 0;
      guard.add(n.toLowerCase());
      const parents = this.supertypesOf(n);
      if (parents.length === 0) return 0;
      return 1 + Math.max(...parents.map((p) => visit(p.name, new Set(guard))));
    };
    return visit(name, new Set());
  }

  /** Classes with no relationship at all. */
  isolatedClasses(): ClassSpec[] {
    return this.classList.filter((c) => this.degree(c.name) === 0);
  }

  hasAnyResponsibility(): boolean {
    return this.classList.some((c) => c.hasResponsibility);
  }

  /**
   * Groups of classes that depend on each other in a loop (strongly connected components of size ≥ 2
   * over the non-structural graph). Bidirectional pairs are 2-cycles.
   */
  usageCycles(): string[][] {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    let counter = 0;

    const successors = (n: string): string[] => [
      ...new Set(this.relList.filter((r) => r.isUsage && eq(r.from, n) && !eq(r.to, n)).map((r) => r.to)),
    ];

    const strongConnect = (v: string): void => {
      index.set(v, counter);
      low.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);
      for (const w of successors(v)) {
        if (!index.has(w)) {
          strongConnect(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
      }
      if (low.get(v) === index.get(v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        if (comp.length >= 2) sccs.push(comp.reverse());
      }
    };

    for (const c of this.classList) if (!index.has(c.name)) strongConnect(c.name);
    return sccs;
  }

  toDto(): DesignModelDto {
    return {
      classes: this.classList.map((c) => c.toDto()),
      relationships: this.relList.map((r) => r.toDto()),
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private related(names: string[]): ClassSpec[] {
    const out: ClassSpec[] = [];
    const seen = new Set<string>();
    for (const n of names) {
      const c = this.find(n);
      if (c && !seen.has(c.name)) {
        seen.add(c.name);
        out.push(c);
      }
    }
    return out;
  }

  private findInheritanceCycle(): string[] | undefined {
    const state = new Map<string, 'visiting' | 'done'>();
    const path: string[] = [];
    const visit = (n: string): string[] | undefined => {
      const s = state.get(n);
      if (s === 'done') return undefined;
      if (s === 'visiting') return [...path.slice(path.indexOf(n)), n];
      state.set(n, 'visiting');
      path.push(n);
      for (const p of this.supertypesOf(n)) {
        const cycle = visit(p.name);
        if (cycle) return cycle;
      }
      path.pop();
      state.set(n, 'done');
      return undefined;
    };
    for (const c of this.classList) {
      const cycle = visit(c.name);
      if (cycle) return cycle;
    }
    return undefined;
  }
}

function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
