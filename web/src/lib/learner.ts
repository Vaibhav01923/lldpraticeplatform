const KEY = 'lld.learnerId';

/**
 * An anonymous, random id kept in this browser. It scopes attempts to a person without accounts:
 * clearing site data starts a fresh history. (A real deployment would put authentication here.)
 */
export function learnerId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Storage blocked (private mode): fall back to an id that lasts for this page load.
    return (window as unknown as { __lld?: string }).__lld ??= crypto.randomUUID();
  }
}
