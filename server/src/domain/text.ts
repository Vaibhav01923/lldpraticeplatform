/**
 * Small text helpers used to compare learner vocabulary with problem concepts.
 * Deliberately simple and deterministic: no NLP library, no network.
 */

/** Split an identifier or phrase into lowercase words: "SpotAllocationStrategy" -> [spot, allocation, strategy]. */
export function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 0);
}

/** Very light stemmer: enough to treat ticket/tickets and strategy/strategies alike. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  return w;
}

/**
 * Whether a learner word expresses a keyword concept.
 * Short keywords (<4 chars, e.g. "car", "ev") must match exactly so "car" never matches "card";
 * longer ones match on shared prefix so "price"/"pricing", "assign"/"assignment" line up.
 */
export function conceptMatches(keyword: string, learnerWord: string): boolean {
  const k = stem(keyword);
  const w = stem(learnerWord);
  if (k.length < 4) return k === w;
  return w.startsWith(k) || (w.length >= 4 && k.startsWith(w));
}

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Clean, trimmed, non-empty lines (bullets and numbering removed). */
export function meaningfulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0);
}

/** Truncate for display/prompting without cutting mid-word where avoidable. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
