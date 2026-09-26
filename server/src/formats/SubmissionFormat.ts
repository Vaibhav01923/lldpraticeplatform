import type { FormatInfoDto, ParseIssueDto } from '../../../shared/contracts';
import type { DesignModel } from '../domain/design/DesignModel';
import { ValidationError } from '../domain/errors';

export interface ParseOutcome {
  /** Present only when `issues` contains no errors. */
  model?: DesignModel;
  issues: ParseIssueDto[];
}

/**
 * A way for a learner to express a design.
 *
 * A format's only job is to turn its own payload into the canonical DesignModel, reporting
 * problems in the learner's own terms (line numbers, field names). Evaluators never see the
 * payload, so adding a format (PlantUML, a code skeleton, an uploaded diagram that something
 * else has already transcribed…) cannot break evaluation.
 */
export interface SubmissionFormat {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** A valid starting payload for the editor. */
  starter(): unknown;
  parse(payload: unknown): ParseOutcome;
}

export class FormatRegistry {
  private readonly formats = new Map<string, SubmissionFormat>();

  constructor(formats: SubmissionFormat[] = []) {
    formats.forEach((f) => this.register(f));
  }

  register(format: SubmissionFormat): this {
    if (this.formats.has(format.id)) throw new Error(`Duplicate submission format '${format.id}'`);
    this.formats.set(format.id, format);
    return this;
  }

  get(id: string): SubmissionFormat {
    const format = this.formats.get(id);
    if (!format) {
      throw new ValidationError(`Unknown submission format '${id}'. Available: ${[...this.formats.keys()].join(', ')}.`);
    }
    return format;
  }

  has(id: string): boolean {
    return this.formats.has(id);
  }

  get defaultId(): string {
    return this.formats.keys().next().value as string;
  }

  list(): FormatInfoDto[] {
    return [...this.formats.values()].map((f) => ({
      id: f.id,
      label: f.label,
      description: f.description,
      starter: f.starter(),
    }));
  }
}
