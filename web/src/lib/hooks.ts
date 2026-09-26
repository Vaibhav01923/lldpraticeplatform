import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptDto, DraftInputDto } from '../../../shared/contracts';
import { api, ApiError } from './api';

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

/**
 * Autosave for a draft.
 *
 * - Debounced: waits for a pause in typing.
 * - Serialised: only one request is in flight; changes made meanwhile are sent right after, so an older
 *   request can never overwrite a newer one.
 * - Revision-aware: every save carries the revision it was based on. A 409 means the draft changed elsewhere
 *   (another tab), so we stop and tell the learner instead of silently clobbering it.
 */
export function useAutosave(attemptId: string, value: DraftInputDto, initialRevision: number, enabled: boolean, onSaved?: (attempt: AttemptDto) => void) {
  const [state, setState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | undefined>();
  const latest = useRef(value);
  const revision = useRef(initialRevision);
  const dirty = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const first = useRef(true);
  const conflicted = useRef(false);

  latest.current = value;

  const flush = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current.then(() => (dirty.current ? flush() : undefined));
    if (!dirty.current || conflicted.current) return Promise.resolve();
    dirty.current = false;
    setState('saving');
    const run = (async () => {
      try {
        const saved = await api.saveDraft(attemptId, revision.current, latest.current);
        revision.current = saved.draft.revision;
        onSaved?.(saved);
        setError(undefined);
        setState(dirty.current ? 'dirty' : 'saved');
      } catch (e) {
        if (e instanceof ApiError && e.code === 'STALE_DRAFT') {
          conflicted.current = true;
          setError(e.message);
          setState('conflict');
        } else {
          dirty.current = true; // keep the change; try again on the next edit
          setError(e instanceof Error ? e.message : 'Could not save.');
          setState('error');
        }
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    dirty.current = true;
    if (!conflicted.current) setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
    return () => clearTimeout(timer.current);
  }, [value, enabled, flush]);

  /** Save right now and wait for it: used before submitting so nothing typed is lost. */
  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    await flush();
    if (inflight.current) await inflight.current;
    return !conflicted.current && !dirty.current;
  }, [flush]);

  return { state, error, saveNow };
}

/** Ticks once a second while `active`, for "evaluating for 12s" style displays. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
