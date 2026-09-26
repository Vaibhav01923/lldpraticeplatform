import { TransientEvaluatorError } from '../Evaluator';
import type { DesignReviewer, ReviewInput } from './DesignReviewer';
import type { RawReview } from './reviewSchema';

export type DemoMode = 'ok' | 'slow' | 'fail' | 'flaky' | 'garbage';

export interface DemoOptions {
  mode?: DemoMode;
  /** Simulated latency for `ok`, and the length of the stall for `slow`. */
  latencyMs?: number;
}

/**
 * A stand-in for a real model, for demos and tests: it needs no API key, and can be told to be slow, fail,
 * flake or return garbage so the platform's degradation paths can be seen and exercised on demand.
 *
 * It is not intelligent. Its "review" is a transparent transformation of the structural findings it is given,
 * and it labels itself as a demo everywhere it speaks, so nobody mistakes it for real AI feedback.
 */
export class DemoDesignReviewer implements DesignReviewer {
  readonly model = 'demo-reviewer (not a real model)';
  private calls = 0;

  constructor(private readonly options: DemoOptions = {}) {}

  async review(input: ReviewInput, signal: AbortSignal): Promise<RawReview> {
    const mode = this.options.mode ?? 'ok';
    this.calls++;

    if (mode === 'fail') throw new TransientEvaluatorError('Demo reviewer is set to fail.');
    if (mode === 'flaky' && this.calls % 2 === 1) throw new TransientEvaluatorError('Demo reviewer failed on this try.');
    if (mode === 'garbage') return { nonsense: true } as unknown as RawReview;

    const wait = mode === 'slow' ? (this.options.latencyMs ?? 120_000) : (this.options.latencyMs ?? 400);
    await sleepUnlessAborted(wait, signal);
    return this.compose(input);
  }

  private compose({ submission, ruleFindings }: ReviewInput): RawReview {
    const model = submission.model;
    const dims = ['requirements', 'responsibilities', 'abstractions', 'extensibility', 'communication'] as const;
    const problems = ruleFindings.filter((f) => f.severity !== 'strength');

    const assessments = dims.map((dimension) => {
      const mine = problems.filter((f) => f.dimension === dimension);
      const penalty = mine.reduce((s, f) => s + (f.severity === 'critical' ? 1.5 : f.severity === 'major' ? 0.8 : 0.3), 0);
      return { dimension, score: Math.max(0.5, 3.4 - penalty), rationale: `Demo estimate from ${mine.length} structural finding(s); not a real judgement.` };
    });

    const widest = [...model.classes].filter((c) => c.kind !== 'enum').sort((a, b) => b.memberCount - a.memberCount)[0];
    const findings: RawReview['findings'] = widest
      ? [{
          dimension: 'responsibilities',
          severity: 'minor',
          title: `Check whether '${widest.name}' has one reason to change`,
          detail: `[Demo] '${widest.name}' has the largest surface in your design (${widest.memberCount} members). A real reviewer would read its responsibility against those members and tell you whether they belong together.`,
          suggestion: `List which members of '${widest.name}' would change for different reasons, and move each group to its own class.`,
          evidenceClasses: [widest.name],
          confidence: 'low',
        }]
      : [];

    const abstraction = model.classes.find((c) => c.isAbstraction && model.subtypesOf(c.name).length > 0);
    const strengths: RawReview['strengths'] = abstraction
      ? [{ dimension: 'abstractions', title: `'${abstraction.name}' has real implementations behind it`, detail: '[Demo] The abstraction is used by more than one concrete class, which is where abstractions pay off.', evidenceClasses: [abstraction.name] }]
      : [];

    return {
      assessments,
      findings,
      strengths,
      disputes: [],
      alternatives: [],
      summary: '[Demo reviewer] This is a stand-in for the AI review: it restates the structural findings and does not read your design. Configure ANTHROPIC_API_KEY for a real review.',
      reflectionQuestions: ['Which of your classes would change first if the requirements changed, and why that one?'],
    };
  }
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
