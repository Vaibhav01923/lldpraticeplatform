import type { CapabilityCoverageDto } from '../../../../shared/contracts';
import { capabilityEvidence, classEvidence, finding, requirementEvidence } from '../../domain/evaluation/Finding';
import { clampScore, plural, type DesignRule, type RuleContext, type RuleOutcome } from './DesignRule';

/**
 * Does each capability the problem demands have an owner in the design?
 *
 * Ownership is judged by vocabulary (see ConceptMatcher), not by matching a reference class list, so
 * `FeeCalculator`, `PricingStrategy` and `TariffPolicy` all count as covering "pricing". A capability that is
 * only mentioned inside another class's description counts as partial: present, but with no home.
 */
export class CapabilityCoverageRule implements DesignRule {
  readonly id = 'capability-coverage';

  evaluate({ problem, matcher }: RuleContext): RuleOutcome {
    const caps = problem.capabilities;
    if (caps.length === 0) return { findings: [], criteria: [] };

    const coverage: CapabilityCoverageDto[] = [];
    const findings: RuleOutcome['findings'] = [];
    let earned = 0;
    let total = 0;

    for (const cap of caps) {
      const weight = cap.weight ?? 1;
      const matches = matcher.match(cap.keywords);
      const named = matches.filter((m) => m.via === 'name');
      const status = named.length > 0 ? 'covered' : matches.length > 0 ? (cap.implicitOk ? 'covered' : 'partial') : 'missing';
      total += weight;
      earned += weight * (status === 'covered' ? 1 : status === 'partial' ? 0.5 : 0);
      coverage.push({
        id: cap.id,
        label: cap.label,
        requirementIds: cap.requirementIds,
        status,
        matchedClasses: (named.length > 0 ? named : matches).map((m) => m.cls.name),
      });

      const reqs = cap.requirementIds.map(requirementEvidence);
      if (status === 'missing') {
        findings.push(
          finding({
            ruleId: 'missing-capability',
            subject: cap.id,
            dimension: 'requirements',
            severity: weight >= 1 ? 'major' : 'minor',
            title: `Nothing owns: ${cap.label}`,
            detail: `${cap.hint} Related requirements: ${cap.requirementIds.join(', ')}. This check looks for the concept by name, so if you cover it under an unexpected name, mention it in that class's responsibility.`,
            suggestion: 'Decide which class is responsible, or say in your assumptions why it is out of scope.',
            evidence: [capabilityEvidence(cap.label), ...reqs],
            confidence: 'medium',
          }),
        );
      } else if (status === 'partial') {
        const where = matches.map((m) => m.cls.name);
        findings.push(
          finding({
            ruleId: 'implicit-capability',
            subject: cap.id,
            dimension: 'requirements',
            severity: 'minor',
            title: `${cap.label} is mentioned but has no class of its own`,
            detail: `It only appears in the description of ${where.join(', ')}. That can be fine for a small, stable concern. If it can vary or grow, it deserves an owner.`,
            suggestion: 'Ask whether this could change independently. If so, give it its own class or interface.',
            evidence: [capabilityEvidence(cap.label), ...where.map((n) => classEvidence(n))],
            confidence: 'medium',
          }),
        );
      }
    }

    const ratio = earned / total;
    const covered = coverage.filter((c) => c.status === 'covered').length;
    const partial = coverage.filter((c) => c.status === 'partial').length;

    if (coverage.every((c) => c.status === 'covered')) {
      findings.push(
        finding({
          ruleId: 'all-capabilities-covered',
          dimension: 'requirements',
          severity: 'strength',
          title: 'Every core capability has an owner',
          detail: `All ${coverage.length} things the problem asks for are represented by a class of their own.`,
          confidence: 'medium',
        }),
      );
    }

    const caps_ = [];
    if (ratio < 0.5) {
      caps_.push({ dimension: 'requirements' as const, max: 1.5, reason: 'Fewer than half of the required capabilities have an owner class.' });
    } else if (ratio < 0.75) {
      caps_.push({ dimension: 'requirements' as const, max: 2.5, reason: 'A quarter or more of the required capabilities have no owner class.' });
    }

    return {
      findings,
      criteria: [
        {
          dimension: 'requirements',
          id: 'capability-coverage',
          label: 'Requirements have an owner',
          score: clampScore(4 * ratio),
          weight: 3,
          reason:
            partial > 0
              ? `${covered} of ${coverage.length} capabilities have their own class, and ${plural(partial, 'more is', 'more are')} only mentioned inside other classes.`
              : `${covered} of ${coverage.length} capabilities have their own class.`,
        },
      ],
      caps: caps_,
      coverage,
    };
  }
}
