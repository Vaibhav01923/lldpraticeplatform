import type { AttemptStatus } from '../../../shared/contracts';
import { Attempt, type AttemptSnapshot } from '../domain/attempt/Attempt';
import { DuplicateAttemptNumberError, type AttemptRepository } from './AttemptRepository';

/** Stores snapshots (not live objects), like a real database would, so callers cannot mutate stored state by accident. */
export class InMemoryAttemptRepository implements AttemptRepository {
  private readonly rows = new Map<string, AttemptSnapshot>();

  async save(attempt: Attempt): Promise<void> {
    const s = attempt.toSnapshot();
    for (const other of this.rows.values()) {
      if (other.id !== s.id && other.learnerId === s.learnerId && other.problemId === s.problemId && other.number === s.number) {
        throw new DuplicateAttemptNumberError();
      }
    }
    this.rows.set(s.id, s);
  }

  async findById(id: string): Promise<Attempt | undefined> {
    const s = this.rows.get(id);
    return s ? Attempt.rehydrate(s) : undefined;
  }

  async listByLearner(learnerId: string, filter: { problemId?: string } = {}): Promise<Attempt[]> {
    return [...this.rows.values()]
      .filter((s) => s.learnerId === learnerId && (!filter.problemId || s.problemId === filter.problemId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number)
      .map((s) => Attempt.rehydrate(s));
  }

  async findByStatus(statuses: readonly AttemptStatus[]): Promise<Attempt[]> {
    return [...this.rows.values()].filter((s) => statuses.includes(s.status)).map((s) => Attempt.rehydrate(s));
  }

  async findOpenDraft(learnerId: string, problemId: string): Promise<Attempt | undefined> {
    const s = [...this.rows.values()].find((r) => r.learnerId === learnerId && r.problemId === problemId && r.status === 'DRAFT');
    return s ? Attempt.rehydrate(s) : undefined;
  }

  async highestNumber(learnerId: string, problemId: string): Promise<number> {
    return Math.max(0, ...[...this.rows.values()].filter((s) => s.learnerId === learnerId && s.problemId === problemId).map((s) => s.number));
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
