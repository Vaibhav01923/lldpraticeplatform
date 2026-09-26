import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AttemptStatus } from '../../../shared/contracts';
import { Attempt, type AttemptSnapshot } from '../domain/attempt/Attempt';
import { DuplicateAttemptNumberError, type AttemptRepository } from './AttemptRepository';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS attempts (
    id          TEXT PRIMARY KEY,
    learner_id  TEXT NOT NULL,
    problem_id  TEXT NOT NULL,
    number      INTEGER NOT NULL,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    data        TEXT NOT NULL,
    UNIQUE (learner_id, problem_id, number)
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_learner ON attempts (learner_id, problem_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_attempts_status  ON attempts (status);
`;

/**
 * SQLite via Node's built-in `node:sqlite` (no native dependency to compile).
 *
 * An attempt is stored as one JSON document next to the few columns we query on. The aggregate is always
 * loaded and saved whole, so there is nothing to gain from normalising it, and its shape can evolve
 * without a migration per field.
 */
export class SqliteAttemptRepository implements AttemptRepository {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  async save(attempt: Attempt): Promise<void> {
    const s = attempt.toSnapshot();
    try {
      this.db
        .prepare(
          `INSERT INTO attempts (id, learner_id, problem_id, number, status, created_at, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, data = excluded.data`,
        )
        .run(s.id, s.learnerId, s.problemId, s.number, s.status, s.createdAt, s.updatedAt, JSON.stringify(s));
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: attempts\.learner_id/.test(error.message)) throw new DuplicateAttemptNumberError();
      throw error;
    }
  }

  async findById(id: string): Promise<Attempt | undefined> {
    return this.one(this.db.prepare('SELECT data FROM attempts WHERE id = ?').get(id));
  }

  async listByLearner(learnerId: string, filter: { problemId?: string } = {}): Promise<Attempt[]> {
    const rows = filter.problemId
      ? this.db.prepare('SELECT data FROM attempts WHERE learner_id = ? AND problem_id = ? ORDER BY created_at DESC, number DESC').all(learnerId, filter.problemId)
      : this.db.prepare('SELECT data FROM attempts WHERE learner_id = ? ORDER BY created_at DESC, number DESC').all(learnerId);
    return rows.map((r) => this.hydrate(r));
  }

  async findByStatus(statuses: readonly AttemptStatus[]): Promise<Attempt[]> {
    if (statuses.length === 0) return [];
    const marks = statuses.map(() => '?').join(', ');
    return this.db.prepare(`SELECT data FROM attempts WHERE status IN (${marks}) ORDER BY created_at`).all(...statuses).map((r) => this.hydrate(r));
  }

  async findOpenDraft(learnerId: string, problemId: string): Promise<Attempt | undefined> {
    return this.one(this.db.prepare("SELECT data FROM attempts WHERE learner_id = ? AND problem_id = ? AND status = 'DRAFT' LIMIT 1").get(learnerId, problemId));
  }

  async highestNumber(learnerId: string, problemId: string): Promise<number> {
    const row = this.db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM attempts WHERE learner_id = ? AND problem_id = ?').get(learnerId, problemId) as { n: number };
    return row.n;
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM attempts WHERE id = ?').run(id);
  }

  private one(row: unknown): Attempt | undefined {
    return row ? this.hydrate(row) : undefined;
  }

  private hydrate(row: unknown): Attempt {
    return Attempt.rehydrate(JSON.parse((row as { data: string }).data) as AttemptSnapshot);
  }
}
