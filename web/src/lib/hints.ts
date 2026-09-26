const key = (attemptId: string) => `lld.hintsOpened.${attemptId}`;

/** Remember that the learner opened the hints while working on this attempt (kept in this browser only). */
export function markHintsOpened(attemptId: string): void {
  try {
    localStorage.setItem(key(attemptId), '1');
  } catch {
    /* storage unavailable (private mode): the nudge is a nicety, so silently skip it */
  }
}

export function hintsWereOpened(attemptId: string): boolean {
  try {
    return localStorage.getItem(key(attemptId)) === '1';
  } catch {
    return false;
  }
}
