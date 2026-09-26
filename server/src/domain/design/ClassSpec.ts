import type { ClassKind, ClassSpecDto } from '../../../../shared/contracts';
import { wordCount } from '../text';

export const CLASS_KINDS: readonly ClassKind[] = ['class', 'interface', 'abstract', 'enum'];

/** One class/interface/enum in a design: its name, single responsibility and public surface. */
export class ClassSpec {
  private constructor(
    readonly name: string,
    readonly kind: ClassKind,
    readonly responsibility: string,
    readonly attributes: readonly string[],
    readonly methods: readonly string[],
  ) {}

  static create(input: {
    name: string;
    kind?: ClassKind;
    responsibility?: string;
    attributes?: string[];
    methods?: string[];
  }): ClassSpec {
    return new ClassSpec(
      input.name.trim(),
      input.kind ?? 'class',
      (input.responsibility ?? '').replace(/\s+/g, ' ').trim(),
      dedupe(input.attributes),
      dedupe(input.methods),
    );
  }

  /** Interfaces and abstract classes are the design's extension points. */
  get isAbstraction(): boolean {
    return this.kind === 'interface' || this.kind === 'abstract';
  }

  get hasResponsibility(): boolean {
    return this.responsibility.length > 0;
  }

  get memberCount(): number {
    return this.attributes.length + this.methods.length;
  }

  /**
   * Rough count of distinct concerns named in the responsibility sentence:
   * "Assigns spots, calculates fees and issues tickets" -> 3.
   * A heuristic for spotting "and-and-and" classes, not a proof.
   */
  responsibilityClauses(): number {
    if (!this.hasResponsibility) return 0;
    return this.responsibility
      .split(/[;,]|\band\b|\bplus\b|&|\+/i)
      .map((p) => p.trim())
      .filter((p) => wordCount(p) >= 2).length;
  }

  /** All the words the learner used to describe this class, for concept matching. */
  descriptiveText(): string {
    return [this.responsibility, ...this.methods, ...this.attributes].join(' ');
  }

  toDto(): ClassSpecDto {
    return {
      name: this.name,
      kind: this.kind,
      responsibility: this.responsibility,
      attributes: [...this.attributes],
      methods: [...this.methods],
    };
  }
}

function dedupe(items: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items ?? []) {
    const item = raw.replace(/\s+/g, ' ').trim();
    if (item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}
