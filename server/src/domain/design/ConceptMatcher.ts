import { conceptMatches, words } from '../text';
import type { ClassSpec } from './ClassSpec';
import type { DesignModel } from './DesignModel';

export interface ConceptMatch {
  cls: ClassSpec;
  /** `name`: the class is named after the concept. `text`: only its responsibility/members mention it. */
  via: 'name' | 'text';
  term: string;
}

/**
 * Finds the classes in a design that express a problem concept ("pricing", "spot allocation").
 *
 * Matching by vocabulary rather than by an exact reference class name is what allows more than one
 * valid design: `FeeCalculator`, `PricingStrategy` and `TariffPolicy` all express the same concept.
 */
export class ConceptMatcher {
  constructor(private readonly model: DesignModel) {}

  match(keywords: readonly string[]): ConceptMatch[] {
    const matches: ConceptMatch[] = [];
    for (const cls of this.model.classes) {
      const nameWords = words(cls.name);
      const byName = firstMatch(keywords, nameWords);
      if (byName) {
        matches.push({ cls, via: 'name', term: byName });
        continue;
      }
      const byText = firstMatch(keywords, words(cls.descriptiveText()));
      if (byText) matches.push({ cls, via: 'text', term: byText });
    }
    return matches;
  }

  /** Classes named after the concept (strong evidence). */
  named(keywords: readonly string[]): ClassSpec[] {
    return this.match(keywords)
      .filter((m) => m.via === 'name')
      .map((m) => m.cls);
  }
}

/**
 * A keyword is one word ("pricing") or several ("spot strategy"); a multi-word keyword matches only
 * when every part is expressed, so generic words like "strategy" do not claim unrelated concepts.
 */
function firstMatch(keywords: readonly string[], learnerWords: string[]): string | undefined {
  for (const k of keywords) {
    const parts = k.split(/\s+/).filter(Boolean);
    if (parts.length > 0 && parts.every((part) => learnerWords.some((w) => conceptMatches(part, w)))) return k;
  }
  return undefined;
}
