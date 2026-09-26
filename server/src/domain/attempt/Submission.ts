import type { SubmissionDto } from '../../../../shared/contracts';
import { DesignModel } from '../design/DesignModel';

/**
 * What the learner handed in, frozen at the moment of submission.
 *
 * It keeps the raw, format-specific payload (so the learner can reopen exactly what they wrote) next to the
 * normalised DesignModel (which is all evaluators read). Later edits to a draft can never change a
 * submission that has been, or is being, evaluated.
 */
export class Submission {
  constructor(
    readonly formatId: string,
    readonly rawDesign: unknown,
    readonly model: DesignModel,
    readonly assumptions: string,
    readonly decisions: string,
    readonly scenarioAnswers: Readonly<Record<string, string>>,
    readonly submittedAt: Date,
  ) {}

  answerFor(scenarioId: string): string {
    return (this.scenarioAnswers[scenarioId] ?? '').trim();
  }

  toDto(): SubmissionDto {
    return {
      format: this.formatId,
      design: this.rawDesign,
      assumptions: this.assumptions,
      decisions: this.decisions,
      scenarioAnswers: { ...this.scenarioAnswers },
      model: this.model.toDto(),
      submittedAt: this.submittedAt.toISOString(),
    };
  }

  static fromDto(dto: SubmissionDto): Submission {
    return new Submission(
      dto.format,
      dto.design,
      DesignModel.fromDto(dto.model),
      dto.assumptions,
      dto.decisions,
      dto.scenarioAnswers,
      new Date(dto.submittedAt),
    );
  }
}
