import { classEvidence, finding, relationshipEvidence } from '../../domain/evaluation/Finding';
import { clampScore, nameList, plural, type DesignRule, type RuleContext, type RuleOutcome } from './DesignRule';

/** A class that nothing uses and that uses nothing has probably been forgotten, or is not needed. */
export class IsolatedClassRule implements DesignRule {
  readonly id = 'isolated-classes';

  evaluate({ model }: RuleContext): RuleOutcome {
    if (model.classes.length < 3) return { findings: [], criteria: [] };
    const isolated = model.isolatedClasses().filter((c) => c.kind !== 'enum');
    const findings: RuleOutcome['findings'] = [];
    if (isolated.length > 0) {
      findings.push(
        finding({
          ruleId: 'isolated-classes',
          dimension: 'abstractions',
          severity: 'minor',
          title: `${nameList(isolated.map((c) => c.name))} ${isolated.length === 1 ? 'is' : 'are'} not connected to anything`,
          detail: 'A class with no relationships either is not needed, or a link is missing. In a working design every class collaborates with at least one other.',
          suggestion: 'Connect it to the class that owns or uses it, or remove it.',
          evidence: isolated.map((c) => classEvidence(c.name)),
          confidence: 'medium',
        }),
      );
    }
    return {
      findings,
      criteria: [
        {
          dimension: 'abstractions',
          id: 'connected-design',
          label: 'Classes are connected',
          score: clampScore(4 - Math.min(3, 1.5 * isolated.length)),
          weight: 1,
          reason: isolated.length === 0 ? 'Every class collaborates with another.' : `${plural(isolated.length, 'class', 'classes')} with no relationships.`,
        },
      ],
    };
  }
}

/** Are interfaces and abstract classes actually implemented, and is there any abstraction at all? */
export class AbstractionUsageRule implements DesignRule {
  readonly id = 'abstraction-usage';

  evaluate({ model }: RuleContext): RuleOutcome {
    const abstractions = model.classes.filter((c) => c.isAbstraction);
    const findings: RuleOutcome['findings'] = [];
    const criteria: RuleOutcome['criteria'] = [];

    const dead = abstractions.filter((c) => model.subtypesOf(c.name).length === 0);
    for (const c of dead) {
      findings.push(
        finding({
          ruleId: 'dead-abstraction',
          subject: c.name,
          dimension: 'abstractions',
          severity: 'major',
          title: `${c.kind === 'interface' ? 'Interface' : 'Abstract class'} '${c.name}' has no implementations`,
          detail: 'An abstraction only earns its place through the variants behind it. With none drawn, a reviewer cannot tell what it abstracts, or whether it is needed. (Ignore this if the implementations live outside the scope of the problem, and say so.)',
          suggestion: 'Add the concrete classes that implement it, at least the ones the requirements need, or drop it until a second variant appears.',
          evidence: [classEvidence(c.name)],
          confidence: 'medium',
        }),
      );
    }
    if (abstractions.length > 0) {
      criteria.push({
        dimension: 'abstractions',
        id: 'abstractions-implemented',
        label: 'Abstractions have implementations',
        score: clampScore(4 - 1.5 * dead.length),
        weight: 1.5,
        reason: dead.length === 0 ? 'Every interface or abstract class has implementations.' : `${plural(dead.length, 'abstraction')} with nothing behind ${dead.length === 1 ? 'it' : 'them'}.`,
      });
    }

    const none = abstractions.length === 0 && model.classes.length >= 5;
    if (none) {
      findings.push(
        finding({
          ruleId: 'no-abstractions',
          dimension: 'abstractions',
          severity: 'minor',
          title: 'Nothing sits behind an interface or abstract class',
          detail: 'That is fine if nothing will vary. Most problems here have rules or algorithms that are likely to change (see the change scenarios), and those are exactly where an abstraction pays off.',
          suggestion: 'Find the one part you would least like to edit when a rule changes, and put it behind an interface.',
          confidence: 'medium',
        }),
      );
    }
    if (none || abstractions.length > 0) {
      criteria.push({
        dimension: 'abstractions',
        id: 'abstraction-in-use',
        label: 'Abstraction is used',
        score: none ? 2 : 4,
        weight: 1,
        reason: none ? 'No interface or abstract class anywhere.' : `${plural(abstractions.length, 'abstraction')} in use.`,
      });
    }
    return { findings, criteria };
  }
}

/** Deep hierarchies are rigid. Composition usually says the same thing more flexibly. */
export class InheritanceDepthRule implements DesignRule {
  readonly id = 'inheritance-depth';

  evaluate({ model }: RuleContext): RuleOutcome {
    let deepest = { name: '', depth: 0 };
    for (const c of model.classes) {
      const d = model.inheritanceDepth(c.name);
      if (d > deepest.depth) deepest = { name: c.name, depth: d };
    }
    const findings: RuleOutcome['findings'] = [];
    if (deepest.depth >= 3) {
      const chain = [deepest.name];
      for (let cur = model.supertypesOf(deepest.name)[0]; cur; cur = model.supertypesOf(cur.name)[0]) chain.push(cur.name);
      findings.push(
        finding({
          ruleId: 'deep-inheritance',
          dimension: 'abstractions',
          severity: deepest.depth >= 4 ? 'major' : 'minor',
          title: `Inheritance runs ${deepest.depth} levels deep`,
          detail: `${chain.join(' → ')}. Every level couples a class to everything above it, and a change near the top ripples down.`,
          suggestion: 'Keep hierarchies to about two levels. Where a subclass exists only to vary one behaviour, pull that behaviour out into a collaborator (for example a strategy).',
          evidence: chain.map((n) => classEvidence(n)),
          confidence: 'medium',
        }),
      );
    }
    return {
      findings,
      criteria: [
        {
          dimension: 'abstractions',
          id: 'shallow-inheritance',
          label: 'Inheritance stays shallow',
          score: deepest.depth <= 2 ? 4 : deepest.depth === 3 ? 3 : 2,
          weight: 0.5,
          reason: deepest.depth <= 2 ? 'No deep hierarchies.' : `A hierarchy ${deepest.depth} levels deep.`,
        },
      ],
    };
  }
}

/** Dependency Inversion: prefer depending on the interface a concrete class implements, not on the class. */
export class DependencyOnConcretionRule implements DesignRule {
  readonly id = 'concrete-dependency';

  evaluate({ model }: RuleContext): RuleOutcome {
    if (!model.classes.some((c) => c.isAbstraction)) return { findings: [], criteria: [] };

    const findings: RuleOutcome['findings'] = [];
    const seen = new Set<string>();
    for (const r of model.relationships) {
      if (r.kind !== 'association' && r.kind !== 'dependency') continue;
      const target = model.find(r.to);
      const source = model.find(r.from);
      if (!target || !source || target.kind !== 'class') continue;
      const abstractParents = model.supertypesOf(target.name).filter((p) => p.isAbstraction);
      if (abstractParents.length === 0) continue;
      // Already depends on (some) abstraction of it, or sits in the same hierarchy: nothing to say.
      const dependsOnAbstraction = abstractParents.some((p) => model.outgoing(source.name).some((o) => o.isUsage && o.to.toLowerCase() === p.name.toLowerCase()));
      const sameHierarchy = abstractParents.some((p) => model.subtypesOf(p.name).some((s) => s.name === source.name));
      if (dependsOnAbstraction || sameHierarchy) continue;
      const key = `${source.name}>${target.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const parent = abstractParents[0]!;
      findings.push(
        finding({
          ruleId: 'concrete-dependency',
          subject: key,
          dimension: 'abstractions',
          severity: 'minor',
          title: `'${source.name}' depends on the concrete '${target.name}', though '${parent.name}' exists`,
          detail: `When a class points at one concrete implementation, adding or swapping a variant means editing that class. Pointing at '${parent.name}' keeps '${source.name}' unchanged when variants come and go.`,
          suggestion: `Point '${source.name}' at '${parent.name}' and let something else decide which concrete class to supply.`,
          evidence: [relationshipEvidence(r.ref), classEvidence(parent.name)],
          confidence: 'medium',
        }),
      );
    }
    return {
      findings,
      criteria: [
        {
          dimension: 'abstractions',
          id: 'depend-on-abstractions',
          label: 'Dependencies point at abstractions',
          score: clampScore(Math.max(1, 4 - findings.length)),
          weight: 1.5,
          reason: findings.length === 0 ? 'Dependencies point at abstractions where they exist.' : `${plural(findings.length, 'dependency', 'dependencies')} on concrete classes that have an interface.`,
        },
      ],
    };
  }
}

/** Classes that depend on each other in a loop cannot be understood, tested or changed independently. */
export class UsageCyclesRule implements DesignRule {
  readonly id = 'mutual-dependency';

  evaluate({ model }: RuleContext): RuleOutcome {
    const cycles = model.usageCycles();
    const findings: RuleOutcome['findings'] = [];
    let twos = 0;
    let bigs = 0;
    for (const cycle of cycles) {
      const members = [...cycle].sort();
      const big = cycle.length >= 3;
      if (big) bigs++;
      else twos++;
      const links = model.relationships.filter((r) => r.isUsage && members.includes(r.from) && members.includes(r.to));
      findings.push(
        finding({
          ruleId: 'mutual-dependency',
          subject: members.join('+'),
          dimension: 'abstractions',
          severity: big ? 'major' : 'minor',
          title: big ? `Circular dependency: ${members.join(', ')}` : `'${members[0]}' and '${members[1]}' depend on each other`,
          detail: big
            ? 'A loop of three or more classes means none of them can be understood, tested or changed on its own.'
            : 'Two-way links make both classes harder to change alone. They are sometimes deliberate (a child holding a pointer to its owner), so treat this as a prompt to check.',
          suggestion: 'Can one direction be replaced by passing the object as an argument, by an interface, or by an event? If the link is a parent pointer, note why it is needed.',
          evidence: [...members.map((m) => classEvidence(m)), ...links.map((l) => relationshipEvidence(l.ref))],
          confidence: big ? 'medium' : 'low',
        }),
      );
    }
    return {
      findings,
      criteria: [
        {
          dimension: 'abstractions',
          id: 'acyclic-dependencies',
          label: 'No dependency loops',
          score: clampScore(4 - 0.5 * twos - 1.5 * bigs),
          weight: 1,
          reason: cycles.length === 0 ? 'No classes depend on each other in a loop.' : `${plural(cycles.length, 'dependency loop')}.`,
        },
      ],
    };
  }
}
