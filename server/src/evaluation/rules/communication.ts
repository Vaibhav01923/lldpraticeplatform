import { meaningfulLines, wordCount } from '../../domain/text';
import { finding, textEvidence } from '../../domain/evaluation/Finding';
import type { DesignRule, RuleContext, RuleOutcome } from './DesignRule';

/** Did the learner clarify the (deliberately vague) prompt before designing? */
export class AssumptionsRule implements DesignRule {
  readonly id = 'assumptions';

  evaluate({ submission }: RuleContext): RuleOutcome {
    const text = submission.assumptions;
    const n = wordCount(text);
    const items = meaningfulLines(text).length;
    const findings: RuleOutcome['findings'] = [];
    let score: number;
    let reason: string;

    if (n < 8) {
      score = 0.5;
      reason = 'No real assumptions were stated.';
      findings.push(
        finding({
          ruleId: 'assumptions-missing',
          dimension: 'communication',
          severity: 'major',
          title: 'No assumptions stated',
          detail: 'Design prompts are deliberately vague. Saying what you assumed (what is in and out of scope, what happens on failure, what the limits are) is the first thing a reviewer looks for.',
          suggestion: 'Write three or four short assumptions: scope, edge cases, and anything you chose not to handle.',
          confidence: 'high',
        }),
      );
    } else if (items < 3) {
      score = 2.5;
      reason = `${items} assumption${items === 1 ? '' : 's'} stated; a few more would round it out.`;
      findings.push(
        finding({
          ruleId: 'assumptions-thin',
          dimension: 'communication',
          severity: 'minor',
          title: 'Assumptions are thin',
          detail: 'One or two assumptions rarely cover scope, failure behaviour and limits.',
          suggestion: 'Add assumptions about what happens when things go wrong, and what you are deliberately leaving out.',
          evidence: [textEvidence(text.slice(0, 120))],
          confidence: 'medium',
        }),
      );
    } else {
      score = 4;
      reason = `${items} assumptions stated.`;
      findings.push(
        finding({
          ruleId: 'assumptions-stated',
          dimension: 'communication',
          severity: 'strength',
          title: 'Assumptions are stated up front',
          detail: 'Clarifying the vague prompt before designing is exactly what reviewers want to see.',
          confidence: 'high',
        }),
      );
    }
    return { findings, criteria: [{ dimension: 'communication', id: 'assumptions-stated', label: 'Assumptions stated', score, weight: 1, reason }] };
  }
}

const RATIONALE = /\b(because|since|so that|trade-?offs?|instead of|rather than|alternatives?|whereas|downside|drawbacks?|at the cost|in exchange|versus|otherwise)\b/gi;

/** Are choices explained, and are alternatives named? */
export class TradeoffsRule implements DesignRule {
  readonly id = 'tradeoffs';

  evaluate({ submission }: RuleContext): RuleOutcome {
    const text = submission.decisions;
    const n = wordCount(text);
    const markers = new Set([...text.matchAll(RATIONALE)].map((m) => m[0].toLowerCase().replace('-', '')));
    const findings: RuleOutcome['findings'] = [];
    let score: number;
    let reason: string;

    if (n < 15) {
      score = 0.5;
      reason = 'No design decisions were explained.';
      findings.push(
        finding({
          ruleId: 'tradeoffs-missing',
          dimension: 'communication',
          severity: 'major',
          title: 'Design decisions are not explained',
          detail: 'A diagram shows what you chose. Reviewers also want to know why, and what you considered and rejected.',
          suggestion: 'Pick your two or three most important choices and write for each: what you chose, why, and the alternative you passed on.',
          confidence: 'high',
        }),
      );
    } else if (markers.size === 0) {
      score = 2;
      reason = 'Decisions are listed without reasons.';
      findings.push(
        finding({
          ruleId: 'tradeoffs-no-reasons',
          dimension: 'communication',
          severity: 'minor',
          title: 'Decisions are listed without reasons',
          detail: 'Naming a pattern is not the same as justifying it. The reasoning is what shows you understand the trade-off.',
          suggestion: 'For each decision, add "because…" and "instead of…" (what you gave up).',
          evidence: [textEvidence(text.slice(0, 120))],
          confidence: 'medium',
        }),
      );
    } else if (markers.size >= 2 && n >= 40) {
      score = 4;
      reason = 'Choices come with reasons and named alternatives.';
      findings.push(
        finding({
          ruleId: 'tradeoffs-articulated',
          dimension: 'communication',
          severity: 'strength',
          title: 'Trade-offs are articulated',
          detail: 'You explained why, and what you weighed against. That is the part of a design that is hardest to fake.',
          confidence: 'medium',
        }),
      );
    } else {
      score = 3;
      reason = 'Reasons are given; naming the alternative you rejected would strengthen them.';
    }
    return { findings, criteria: [{ dimension: 'communication', id: 'tradeoffs-articulated', label: 'Trade-offs articulated', score, weight: 1.5, reason }] };
  }
}
