import type { AttemptStatus } from '../../../shared/contracts';
import type { Attempt } from '../domain/attempt/Attempt';

/** Two attempts by the same learner at the same problem were given the same number (a concurrent start). */
export class DuplicateAttemptNumberError extends Error {
  constructor() {
    super('An attempt with this number already exists for this learner and problem.');
    this.name = 'DuplicateAttemptNumberError';
  }
}

/**
 * Where attempts live. The domain and application layers depend only on this interface; the SQLite
 * implementation is one adapter, and the in-memory one (used in tests) is another. Methods are async
 * so an implementation backed by a networked database needs no change to its callers.
 */
export interface AttemptRepository {
  /** Insert or update. Throws DuplicateAttemptNumberError if (learner, problem, number) is taken by another attempt. */
  save(attempt: Attempt): Promise<void>;
  findById(id: string): Promise<Attempt | undefined>;
  /** Newest first. */
  listByLearner(learnerId: string, filter?: { problemId?: string }): Promise<Attempt[]>;
  findByStatus(statuses: readonly AttemptStatus[]): Promise<Attempt[]>;
  /** The learner's one unsubmitted attempt at this problem, if any. */
  findOpenDraft(learnerId: string, problemId: string): Promise<Attempt | undefined>;
  /** Highest attempt number the learner has used for this problem (0 if none). */
  highestNumber(learnerId: string, problemId: string): Promise<number>;
  delete(id: string): Promise<void>;
}
