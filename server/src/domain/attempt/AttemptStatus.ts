import type { AttemptStatus } from '../../../../shared/contracts';

/**
 * The attempt lifecycle, as data.
 *
 *   DRAFT ──submit──▶ SUBMITTED ──worker──▶ EVALUATING ──▶ EVALUATED
 *                        ▲                       │  ├────▶ PARTIALLY_EVALUATED ──retry──┐
 *                        │                       │  └────▶ EVALUATION_FAILED ───retry──┤
 *                        └──── requeue (crash) ──┘                                     │
 *                        └─────────────────────────────────────────────────────────────┘
 *
 * A transition table rather than one State class per status: legality is the only thing that differs
 * between statuses (no per-state behaviour), so a table is smaller, and the whole machine reads at a glance.
 */
export const TRANSITIONS: Readonly<Record<AttemptStatus, readonly AttemptStatus[]>> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['EVALUATING'],
  EVALUATING: ['EVALUATED', 'PARTIALLY_EVALUATED', 'EVALUATION_FAILED', 'SUBMITTED'],
  EVALUATED: [],
  PARTIALLY_EVALUATED: ['SUBMITTED'],
  EVALUATION_FAILED: ['SUBMITTED'],
};

export function canTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses in which work is (or will be) in flight, and the worker should not be idle. */
export const IN_FLIGHT: readonly AttemptStatus[] = ['SUBMITTED', 'EVALUATING'];

/** Statuses where the learner has feedback worth showing. */
export function hasFeedback(status: AttemptStatus): boolean {
  return status === 'EVALUATED' || status === 'PARTIALLY_EVALUATED';
}
