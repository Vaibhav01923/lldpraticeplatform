import { afterEach, describe, expect, it, vi } from 'vitest';
import { hintsWereOpened, markHintsOpened } from './hints';

function fakeStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('hint usage flag', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is per attempt', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(hintsWereOpened('a1')).toBe(false);
    markHintsOpened('a1');
    expect(hintsWereOpened('a1')).toBe(true);
    expect(hintsWereOpened('a2')).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    vi.stubGlobal('localStorage', blocked);
    expect(() => markHintsOpened('a1')).not.toThrow();
    expect(hintsWereOpened('a1')).toBe(false);
  });
});
