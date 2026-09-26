import { wordCount, words } from '../../domain/text';
import { classEvidence, finding } from '../../domain/evaluation/Finding';
import { clampScore, nameList, plural, type DesignRule, type RuleContext, type RuleOutcome } from './DesignRule';

/** Does every class say, in a sentence, what it is responsible for? */
export class ResponsibilitiesStatedRule implements DesignRule {
  readonly id = 'responsibilities-stated';

  evaluate({ model, submission }: RuleContext): RuleOutcome {
    const classes = model.classes.filter((c) => c.kind !== 'enum');
    if (classes.length === 0) return { findings: [], criteria: [] };

    const lacking = classes.filter((c) => wordCount(c.responsibility) < 3);
    const ratio = 1 - lacking.length / classes.length;
    const findings: RuleOutcome['findings'] = [];

    if (lacking.length > 0) {
      const example = lacking[0]!.name;
      const suggestion =
        submission.formatId === 'mermaid-class'
          ? `Add a line such as: note for ${example} "what it is responsible for".`
          : 'Fill in the responsibility field on each card with one sentence: what does this class own and decide?';
      findings.push(
        finding({
          ruleId: 'responsibilities-stated',
          dimension: 'responsibilities',
          severity: lacking.length * 2 >= classes.length ? 'major' : 'minor',
          title:
            lacking.length === 1
              ? `'${example}' has no stated responsibility`
              : `${lacking.length} classes have no stated responsibility`,
          detail:
            'Without a stated job, neither you nor a reviewer can tell whether a class does too much or too little. A responsibility shorter than three words usually just repeats the name.',
          suggestion,
          evidence: lacking.slice(0, 8).map((c) => classEvidence(c.name)),
          confidence: 'high',
        }),
      );
    } else if (classes.length >= 3) {
      findings.push(
        finding({
          ruleId: 'responsibilities-stated-ok',
          dimension: 'responsibilities',
          severity: 'strength',
          title: 'Every class states its job',
          detail: 'Each class has a stated responsibility, which makes the design reviewable.',
          confidence: 'high',
        }),
      );
    }

    return {
      findings,
      criteria: [
        {
          dimension: 'responsibilities',
          id: 'responsibilities-stated',
          label: 'Responsibilities are stated',
          score: clampScore(4 * ratio),
          weight: 1.5,
          reason:
            lacking.length === 0
              ? 'Every class states its responsibility.'
              : `${lacking.length} of ${classes.length} classes state no real responsibility (${nameList(lacking.map((c) => c.name))}).`,
        },
      ],
    };
  }
}

/** Heuristic "does this class do too much?" check: a smell to look at, not a verdict. */
export class GodClassRule implements DesignRule {
  readonly id = 'god-class';

  static readonly thresholds = { methods: 9, members: 14, clauses: 4, collaborators: 6 } as const;

  evaluate({ model }: RuleContext): RuleOutcome {
    const t = GodClassRule.thresholds;
    const findings: RuleOutcome['findings'] = [];
    let majors = 0;
    let minors = 0;

    for (const c of model.classes) {
      if (c.kind === 'enum') continue;
      const reasons: string[] = [];
      if (c.methods.length >= t.methods || c.memberCount >= t.members) {
        reasons.push(`it lists ${plural(c.methods.length, 'method')} and ${plural(c.attributes.length, 'attribute')}`);
      }
      const clauses = c.responsibilityClauses();
      if (clauses >= t.clauses) reasons.push(`its responsibility names ${clauses} separate concerns`);
      const fanOut = model.collaboratorsOf(c.name).length;
      if (fanOut >= t.collaborators) reasons.push(`it collaborates with ${fanOut} other classes`);
      if (reasons.length === 0) continue;

      const major = reasons.length >= 2;
      if (major) majors++;
      else minors++;
      const isInterface = c.kind === 'interface';
      findings.push(
        finding({
          ruleId: 'god-class',
          subject: c.name,
          dimension: 'responsibilities',
          severity: major ? 'major' : 'minor',
          title: isInterface ? `'${c.name}' may be a fat interface` : `'${c.name}' may be doing too much`,
          detail: `${capitalise(reasons.join(', and '))}. ${
            isInterface
              ? 'Interfaces that many clients only partly use force every implementor to carry methods it does not need.'
              : 'Classes with many jobs are hard to test and every change request lands on them.'
          } Coordinating classes such as a facade can legitimately be wide, as long as they delegate rather than do the work.`,
          suggestion: isInterface
            ? 'Split it into smaller interfaces by who uses them.'
            : 'Ask which parts of it would change for different reasons. Give each part its own class and let this one coordinate.',
          evidence: [classEvidence(c.name, reasons[0])],
          confidence: major ? 'medium' : 'low',
        }),
      );
    }

    return {
      findings,
      criteria: [
        {
          dimension: 'responsibilities',
          id: 'focused-classes',
          label: 'Classes stay focused',
          score: clampScore(4 - 1.5 * majors - 0.75 * minors),
          weight: 2,
          reason:
            findings.length === 0
              ? 'No class looks overloaded.'
              : `${plural(findings.length, 'class')} may be overloaded (${nameList(findings.map((f) => f.evidence[0]!.ref))}).`,
        },
      ],
    };
  }
}

const VAGUE = new Set(['manager', 'helper', 'util', 'utils', 'utility', 'utilities', 'handler', 'processor', 'data', 'info', 'misc', 'common', 'stuff', 'thing', 'object']);

/** Names like "DataManager" and "Helper" say what a class is, not what it is for. */
export class VagueNamesRule implements DesignRule {
  readonly id = 'vague-names';

  evaluate({ model }: RuleContext): RuleOutcome {
    const vague = model.classes.filter((c) => words(c.name).some((w) => VAGUE.has(w)));
    const findings: RuleOutcome['findings'] = [];
    if (vague.length > 0) {
      findings.push(
        finding({
          ruleId: 'vague-names',
          dimension: 'responsibilities',
          severity: 'minor',
          title: `Vague class ${vague.length === 1 ? 'name' : 'names'}: ${nameList(vague.map((c) => c.name))}`,
          detail:
            'Names such as Manager, Helper or Handler tend to attract unrelated work, because anything can be argued to belong there. This only matters if the name is hiding more than one job.',
          suggestion: 'Rename each after the one thing it does (for example FeeCalculator instead of ParkingManager).',
          evidence: vague.map((c) => classEvidence(c.name)),
          confidence: 'low',
        }),
      );
    }
    return {
      findings,
      criteria: [
        {
          dimension: 'responsibilities',
          id: 'specific-names',
          label: 'Names say what a class is for',
          score: Math.max(2, clampScore(4 - 0.5 * vague.length)),
          weight: 0.5,
          reason: vague.length === 0 ? 'Class names are specific.' : `${plural(vague.length, 'class name')} could be more specific.`,
        },
      ],
    };
  }
}

/** Too small to judge, or so large it suggests modelling every noun. */
export class DesignSizeRule implements DesignRule {
  readonly id = 'design-size';

  evaluate({ model }: RuleContext): RuleOutcome {
    const n = model.classes.length;
    if (n < 3) {
      return {
        findings: [
          finding({
            ruleId: 'design-too-small',
            dimension: 'responsibilities',
            severity: 'critical',
            title: `Only ${plural(n, 'class', 'classes')}: too small to judge`,
            detail: 'With fewer than three classes there is not enough structure to assess ownership, abstraction or extensibility, so scores are capped until the design has more shape.',
            suggestion: 'List the nouns in the requirements, then decide which of them enforce rules or hold changing state. Those become classes.',
            confidence: 'high',
          }),
        ],
        criteria: [{ dimension: 'responsibilities', id: 'design-size', label: 'Enough structure to review', score: 1, weight: 1, reason: `Only ${plural(n, 'class', 'classes')}.` }],
        caps: [{ dimension: 'all', max: 1.5, reason: 'The design has fewer than three classes, which is too little to judge.' }],
      };
    }
    if (n > 20) {
      return {
        findings: [
          finding({
            ruleId: 'design-too-large',
            dimension: 'responsibilities',
            severity: 'minor',
            title: `${n} classes is a lot for an interview-sized problem`,
            detail: 'Modelling every noun as a class tends to bury the important design decisions. Reviewers usually want to see the core, not the whole world.',
            suggestion: 'Merge classes that only hold data into their owners, and leave out anything the requirements do not need.',
            confidence: 'medium',
          }),
        ],
        criteria: [{ dimension: 'responsibilities', id: 'design-size', label: 'Enough structure, not too much', score: 3, weight: 1, reason: `${n} classes is on the large side.` }],
      };
    }
    return {
      findings: [],
      criteria: [{ dimension: 'responsibilities', id: 'design-size', label: 'Enough structure to review', score: 4, weight: 1, reason: `${n} classes is a reviewable size.` }],
    };
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
