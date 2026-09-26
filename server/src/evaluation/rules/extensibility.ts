import { classEvidence, finding, scenarioEvidence, textEvidence } from '../../domain/evaluation/Finding';
import type { ClassSpec } from '../../domain/design/ClassSpec';
import type { DesignModel } from '../../domain/design/DesignModel';
import { wordCount, words } from '../../domain/text';
import { clampScore, nameList, type DesignRule, type RuleContext, type RuleOutcome } from './DesignRule';

type Handling = 'abstraction-many' | 'abstraction-one' | 'abstraction-none' | 'enum' | 'type-field' | 'concrete' | 'text-only';

const VALUE: Record<Handling, number> = {
  'abstraction-many': 1,
  'abstraction-one': 0.75,
  'abstraction-none': 0.5,
  enum: 0.75,
  'type-field': 0.5,
  concrete: 0,
  'text-only': 0.25,
};

const TYPE_FIELD_WORDS = new Set(['type', 'kind', 'category', 'size', 'mode']);

/**
 * For each thing the problem says will vary, is it behind an abstraction?
 *
 * The check accepts more than one valid shape: an interface with implementations, or (where the problem
 * says so) an enum. It complains only when the varying concept is a single concrete class, because then a
 * new variant means editing that class instead of adding one.
 */
export class VariabilityRule implements DesignRule {
  readonly id = 'variability';

  evaluate({ problem, model, matcher }: RuleContext): RuleOutcome {
    const findings: RuleOutcome['findings'] = [];
    const handled: string[] = [];
    let total = 0;
    let evaluated = 0;

    for (const point of problem.variabilityPoints) {
      const matches = matcher.match(point.keywords);
      if (matches.length === 0) continue; // nothing to judge; the coverage rule reports absence
      evaluated++;
      const named = matches.filter((m) => m.via === 'name').map((m) => m.cls);
      const allowEnum = point.accepts === 'abstraction-or-enum';

      if (named.length === 0) {
        total += VALUE['text-only'];
        findings.push(
          finding({
            ruleId: 'variability-inline',
            subject: point.id,
            dimension: 'extensibility',
            severity: 'minor',
            title: `${point.label} lives inside ${nameList(matches.map((m) => m.cls.name), 2)}`,
            detail: `${point.why} It is only described inside another class, so a new variant would mean editing that class.`,
            suggestion: 'Give it its own interface, with one class per variant.',
            evidence: matches.map((m) => classEvidence(m.cls.name)),
            confidence: 'medium',
          }),
        );
        continue;
      }

      const { handling, cls } = classify(named, model, allowEnum);
      total += VALUE[handling];
      const evidence = [classEvidence(cls.name)];

      switch (handling) {
        case 'abstraction-many':
        case 'enum':
          handled.push(`${point.label} (${cls.name})`);
          break;
        case 'abstraction-one':
          handled.push(`${point.label} (${cls.name})`);
          findings.push(
            finding({
              ruleId: 'single-variant',
              subject: point.id,
              dimension: 'extensibility',
              severity: 'minor',
              title: `${point.label}: only one variant is shown behind '${cls.name}'`,
              detail: 'The extension point is there, but one implementation does not show that a second would slot in cleanly.',
              suggestion: 'Sketch a second variant, even a hypothetical one, to check the interface really fits both.',
              evidence,
              confidence: 'medium',
            }),
          );
          break;
        case 'abstraction-none':
          // Reported by the dead-abstraction rule; no second finding here.
          break;
        case 'type-field':
          findings.push(
            finding({
              ruleId: 'type-field',
              subject: point.id,
              dimension: 'extensibility',
              severity: 'minor',
              title: `${point.label} is modelled as a type field on '${cls.name}'`,
              detail: `${point.why} A type field is fine for data. If behaviour differs by type, code ends up switching on it, and each new type edits that code.`,
              suggestion: 'If the behaviour differs, give each variant its own class behind an interface. If only the data differs, an enum is fine. Say which in your decisions.',
              evidence,
              confidence: 'medium',
            }),
          );
          break;
        case 'concrete':
          findings.push(
            finding({
              ruleId: 'concrete-variation',
              subject: point.id,
              dimension: 'extensibility',
              severity: 'major',
              title: `${point.label} is a single concrete class ('${cls.name}')`,
              detail: `${point.why} With one concrete class, a new variant means editing '${cls.name}' rather than adding something next to it (Open/Closed).`,
              suggestion: 'Put the varying behaviour behind an interface and give each variant its own class.',
              evidence,
              confidence: 'medium',
            }),
          );
          break;
        default:
          break;
      }
    }

    if (handled.length > 0) {
      findings.push(
        finding({
          ruleId: 'variability-handled',
          dimension: 'extensibility',
          severity: 'strength',
          title: 'Variation points are isolated',
          detail: `Behind an abstraction (or a deliberate enum): ${handled.join('; ')}. New variants here are additions, not edits.`,
          confidence: 'medium',
        }),
      );
    }

    if (evaluated === 0) return { findings, criteria: [] };
    return {
      findings,
      criteria: [
        {
          dimension: 'extensibility',
          id: 'variability-points',
          label: 'Variation points are isolated',
          score: clampScore((4 * total) / evaluated),
          weight: 2,
          reason: `${handled.length} of ${evaluated} things likely to change are isolated behind an abstraction.`,
        },
      ],
    };
  }
}

function classify(named: ClassSpec[], model: DesignModel, allowEnum: boolean): { handling: Handling; cls: ClassSpec } {
  const abstractions = named.filter((c) => c.isAbstraction);
  const withMany = abstractions.find((c) => model.subtypesOf(c.name).length >= 2);
  if (withMany) return { handling: 'abstraction-many', cls: withMany };
  const withOne = abstractions.find((c) => model.subtypesOf(c.name).length === 1);
  if (withOne) return { handling: 'abstraction-one', cls: withOne };
  const enumClass = allowEnum ? named.find((c) => c.kind === 'enum') : undefined;
  if (enumClass) return { handling: 'enum', cls: enumClass };
  if (abstractions[0]) return { handling: 'abstraction-none', cls: abstractions[0] };
  // An abstract-looking parent that is a plain class with subclasses (Vehicle <|-- Car) is polymorphism too.
  const parent = named.find((c) => model.subtypesOf(c.name).length >= 1);
  if (parent) return { handling: model.subtypesOf(parent.name).length >= 2 ? 'abstraction-many' : 'abstraction-one', cls: parent };
  const typed = allowEnum ? named.find((c) => c.attributes.some((a) => words(a).some((w) => TYPE_FIELD_WORDS.has(w)))) : undefined;
  if (typed) return { handling: 'type-field', cls: typed };
  return { handling: 'concrete', cls: named[0]! };
}

/**
 * The learner is asked "what changes if…?" for a few realistic change requests. Answering against their own
 * classes is the cheapest honest test of extensibility. This rule checks that the answers exist and are about
 * the design; whether they are *good* is the AI reviewer's job.
 */
export class ChangeScenarioRule implements DesignRule {
  readonly id = 'change-scenarios';

  evaluate({ problem, submission, model }: RuleContext): RuleOutcome {
    if (problem.scenarios.length === 0) return { findings: [], criteria: [] };

    const findings: RuleOutcome['findings'] = [];
    let total = 0;
    let grounded = 0;

    for (const s of problem.scenarios) {
      const answer = submission.answerFor(s.id);
      const n = wordCount(answer);
      const mentioned = model.classes.filter((c) => mentions(answer, c)).map((c) => c.name);
      const evidence = [scenarioEvidence(`${s.id}: ${s.prompt}`)];

      if (n === 0) {
        findings.push(
          finding({
            ruleId: 'scenario-unanswered',
            subject: s.id,
            dimension: 'extensibility',
            severity: 'major',
            title: `Change scenario ${s.id} was not answered`,
            detail: `"${s.prompt}" Answering "what would I have to change?" is the fastest test of whether a design is extensible. If the honest answer is "a lot of classes", that is the useful finding.`,
            suggestion: 'Name the classes you would add and the classes you would have to edit. Fewer edits is better.',
            evidence,
            confidence: 'high',
          }),
        );
      } else if (n < 12) {
        total += 0.4;
        findings.push(
          finding({
            ruleId: 'scenario-brief',
            subject: s.id,
            dimension: 'extensibility',
            severity: 'minor',
            title: `Your answer to scenario ${s.id} is very short`,
            detail: 'A one-line answer cannot show which classes stay untouched, which is the point of the exercise.',
            suggestion: 'Say what you would add, what you would edit, and what would not change.',
            evidence: [...evidence, textEvidence(answer)],
            confidence: 'high',
          }),
        );
      } else if (mentioned.length === 0) {
        total += 0.6;
        findings.push(
          finding({
            ruleId: 'scenario-ungrounded',
            subject: s.id,
            dimension: 'extensibility',
            severity: 'minor',
            title: `Your answer to scenario ${s.id} does not mention any of your classes`,
            detail: 'The answer is more convincing when it is tied to your own design: "I would add X implementing Y, and ParkingLot would not change."',
            suggestion: 'Rewrite it using the names of the classes in your design.',
            evidence: [...evidence, textEvidence(answer)],
            confidence: 'medium',
          }),
        );
      } else {
        total += 1;
        grounded++;
      }
    }

    if (grounded === problem.scenarios.length) {
      findings.push(
        finding({
          ruleId: 'scenarios-grounded',
          dimension: 'extensibility',
          severity: 'strength',
          title: 'Change scenarios are answered against your own classes',
          detail: 'Every scenario has an answer that refers to your design, which is exactly how to test extensibility.',
          confidence: 'high',
        }),
      );
    }

    return {
      findings,
      criteria: [
        {
          dimension: 'extensibility',
          id: 'change-scenarios',
          label: 'Change scenarios answered',
          score: clampScore((4 * total) / problem.scenarios.length),
          weight: 2,
          reason: `${grounded} of ${problem.scenarios.length} scenarios have a substantive answer that refers to the design.`,
        },
      ],
    };
  }
}

/** Whether a free-text answer refers to a class, by name or by its words ("pricing strategy" for PricingStrategy). */
function mentions(answer: string, cls: ClassSpec): boolean {
  const text = ` ${words(answer).join(' ')} `;
  const name = words(cls.name).join(' ');
  return name.length > 0 && text.includes(` ${name} `);
}
