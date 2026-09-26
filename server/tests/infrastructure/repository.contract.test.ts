import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Attempt } from '../../src/domain/attempt/Attempt';
import { DuplicateAttemptNumberError, type AttemptRepository } from '../../src/infrastructure/AttemptRepository';
import { InMemoryAttemptRepository } from '../../src/infrastructure/InMemoryAttemptRepository';
import { SqliteAttemptRepository } from '../../src/infrastructure/SqliteAttemptRepository';
import { crcSubmission } from '../helpers/fixtures';

const make = (id: string, learner: string, problem: string, number: number, minute = number) =>
  Attempt.start({ id, learnerId: learner, problemId: problem, number, now: new Date(Date.UTC(2026, 0, 1, 10, minute)), formatId: 'crc-cards', starterDesign: { classes: [], relationships: [] } });

/**
 * One behavioural contract, run against every AttemptRepository implementation. If a third adapter
 * (Postgres, DynamoDB…) is added, it is correct when this suite passes for it.
 */
function contract(name: string, create: () => { repo: AttemptRepository; cleanup: () => void }) {
  describe(`AttemptRepository contract: ${name}`, () => {
    let repo: AttemptRepository;
    let cleanup: () => void;
    beforeEach(() => ({ repo, cleanup } = create()));
    afterEach(() => cleanup());

    it('saves and loads an attempt, including a full submission and report', async () => {
      const a = make('a1', 'L1', 'parking-lot', 1);
      a.submit(crcSubmission(), new Date());
      await repo.save(a);
      const loaded = (await repo.findById('a1'))!;
      expect(loaded.toSnapshot()).toEqual(a.toSnapshot());
      expect(loaded.submission!.model.classes.length).toBeGreaterThan(5);
    });

    it('returns undefined for an unknown id', async () => {
      expect(await repo.findById('nope')).toBeUndefined();
    });

    it('updates in place when saved again', async () => {
      const a = make('a1', 'L1', 'parking-lot', 1);
      await repo.save(a);
      a.saveDraft({ format: 'crc-cards', design: {}, assumptions: 'changed', decisions: '', scenarioAnswers: {} }, 0, new Date());
      await repo.save(a);
      expect((await repo.findById('a1'))!.draft.assumptions).toBe('changed');
      expect(await repo.listByLearner('L1')).toHaveLength(1);
    });

    it('does not hand out live objects: mutating a loaded attempt changes nothing until saved', async () => {
      await repo.save(make('a1', 'L1', 'parking-lot', 1));
      const copy = (await repo.findById('a1'))!;
      copy.saveDraft({ format: 'crc-cards', design: {}, assumptions: 'unsaved', decisions: '', scenarioAnswers: {} }, 0, new Date());
      expect((await repo.findById('a1'))!.draft.assumptions).toBe('');
    });

    it('lists only the learner\'s attempts, newest first, optionally per problem', async () => {
      await repo.save(make('a1', 'L1', 'parking-lot', 1));
      await repo.save(make('a2', 'L1', 'parking-lot', 2));
      await repo.save(make('a3', 'L1', 'elevator', 1, 3));
      await repo.save(make('b1', 'L2', 'parking-lot', 1));
      expect((await repo.listByLearner('L1')).map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
      expect((await repo.listByLearner('L1', { problemId: 'parking-lot' })).map((a) => a.id)).toEqual(['a2', 'a1']);
      expect(await repo.listByLearner('nobody')).toEqual([]);
    });

    it('finds attempts by status', async () => {
      const a = make('a1', 'L1', 'parking-lot', 1);
      const b = make('a2', 'L1', 'parking-lot', 2);
      b.submit(crcSubmission(), new Date());
      await repo.save(a);
      await repo.save(b);
      expect((await repo.findByStatus(['SUBMITTED'])).map((x) => x.id)).toEqual(['a2']);
      expect((await repo.findByStatus(['DRAFT', 'SUBMITTED'])).map((x) => x.id).sort()).toEqual(['a1', 'a2']);
      expect(await repo.findByStatus([])).toEqual([]);
    });

    it('finds the open draft for a learner and problem', async () => {
      const done = make('a1', 'L1', 'parking-lot', 1);
      done.submit(crcSubmission(), new Date());
      await repo.save(done);
      await repo.save(make('a2', 'L1', 'parking-lot', 2));
      await repo.save(make('x', 'L2', 'parking-lot', 1));
      expect((await repo.findOpenDraft('L1', 'parking-lot'))!.id).toBe('a2');
      expect(await repo.findOpenDraft('L1', 'elevator')).toBeUndefined();
    });

    it('numbers attempts per learner and problem', async () => {
      expect(await repo.highestNumber('L1', 'parking-lot')).toBe(0);
      await repo.save(make('a1', 'L1', 'parking-lot', 1));
      await repo.save(make('a2', 'L1', 'parking-lot', 2));
      await repo.save(make('b1', 'L2', 'parking-lot', 1));
      expect(await repo.highestNumber('L1', 'parking-lot')).toBe(2);
      expect(await repo.highestNumber('L2', 'parking-lot')).toBe(1);
    });

    it('refuses two different attempts with the same number for one learner and problem', async () => {
      await repo.save(make('a1', 'L1', 'parking-lot', 1));
      await expect(repo.save(make('a1-dup', 'L1', 'parking-lot', 1))).rejects.toBeInstanceOf(DuplicateAttemptNumberError);
      await repo.save(make('other-learner', 'L2', 'parking-lot', 1)); // same number, different learner: fine
    });

    it('deletes an attempt, and deleting a missing one is harmless', async () => {
      await repo.save(make('a1', 'L1', 'parking-lot', 1));
      await repo.delete('a1');
      await repo.delete('a1');
      expect(await repo.findById('a1')).toBeUndefined();
    });
  });
}

contract('in-memory', () => ({ repo: new InMemoryAttemptRepository(), cleanup: () => {} }));
contract('SQLite (:memory:)', () => {
  const repo = new SqliteAttemptRepository(':memory:');
  return { repo, cleanup: () => repo.close() };
});

describe('SqliteAttemptRepository on disk', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lld-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates missing directories and survives being reopened (data outlives the process)', async () => {
    const path = join(dir, 'nested', 'deeper', 'lld.db');
    const first = new SqliteAttemptRepository(path);
    await first.save(make('a1', 'L1', 'parking-lot', 1));
    first.close();
    const second = new SqliteAttemptRepository(path);
    expect((await second.findById('a1'))!.number).toBe(1);
    second.close();
  });
});
