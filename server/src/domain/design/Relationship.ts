import type { RelationKind, RelationshipDto } from '../../../../shared/contracts';

export const RELATION_KINDS: readonly RelationKind[] = [
  'inheritance',
  'realization',
  'composition',
  'aggregation',
  'association',
  'dependency',
];

/** A directed link between two classes. `from` is always the class that knows about / extends / owns `to`. */
export class Relationship {
  constructor(
    readonly from: string,
    readonly to: string,
    readonly kind: RelationKind,
    readonly label: string = '',
  ) {}

  /** "is-a": inheritance and realization. */
  get isStructural(): boolean {
    return this.kind === 'inheritance' || this.kind === 'realization';
  }

  /** "has-a" with ownership semantics. */
  get isOwnership(): boolean {
    return this.kind === 'composition' || this.kind === 'aggregation';
  }

  /** Everything that couples `from` to the *behaviour* of `to` at runtime. */
  get isUsage(): boolean {
    return !this.isStructural;
  }

  involves(className: string): boolean {
    const n = className.toLowerCase();
    return this.from.toLowerCase() === n || this.to.toLowerCase() === n;
  }

  /** Stable reference used as evidence: "ParkingLot --composition--> Level". */
  get ref(): string {
    return `${this.from} --${this.kind}--> ${this.to}`;
  }

  toDto(): RelationshipDto {
    return { from: this.from, to: this.to, kind: this.kind, ...(this.label ? { label: this.label } : {}) };
  }
}
