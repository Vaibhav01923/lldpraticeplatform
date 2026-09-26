import { z } from 'zod';
import type { ParseIssueDto } from '../../../shared/contracts';
import { DesignModel } from '../domain/design/DesignModel';
import type { ParseOutcome, SubmissionFormat } from './SubmissionFormat';

const ClassCard = z.object({
  name: z.string().default(''),
  kind: z.enum(['class', 'interface', 'abstract', 'enum']).default('class'),
  responsibility: z.string().default(''),
  attributes: z.array(z.string()).default([]),
  methods: z.array(z.string()).default([]),
});

const RelationRow = z.object({
  from: z.string().default(''),
  to: z.string().default(''),
  kind: z.enum(['inheritance', 'realization', 'composition', 'aggregation', 'association', 'dependency']).default('association'),
  label: z.string().default(''),
});

const Payload = z.object({
  classes: z.array(ClassCard).default([]),
  relationships: z.array(RelationRow).default([]),
});

/**
 * Structured "CRC card" input: each class has a name, kind, one-sentence responsibility and its
 * public members; collaborators are the relationships between cards.
 *
 * Asking for the responsibility explicitly is the point of the format: it is the piece of a design
 * that is hardest to judge from a bare class diagram, and the piece that reveals whether the learner
 * has actually decided what each class owns.
 */
export class CrcCardsFormat implements SubmissionFormat {
  readonly id = 'crc-cards';
  readonly label = 'Class cards';
  readonly description =
    'One card per class: its name, a one-sentence responsibility, and its key attributes and methods. Then connect the cards.';

  starter(): unknown {
    return { classes: [], relationships: [] };
  }

  parse(payload: unknown): ParseOutcome {
    const parsed = Payload.safeParse(payload);
    if (!parsed.success) {
      return {
        issues: parsed.error.issues.map(
          (i): ParseIssueDto => ({ severity: 'error', message: i.message, location: i.path.join('.') }),
        ),
      };
    }

    const issues: ParseIssueDto[] = [];
    // A card the learner added but never filled in is noise, not an error.
    const classes = parsed.data.classes.filter((c) => !isBlankCard(c));
    classes.forEach((c, i) => {
      if (!c.name.trim()) issues.push({ severity: 'error', message: `Class card ${i + 1} has content but no name.`, location: `classes.${i}` });
    });
    const relationships = parsed.data.relationships.filter((r) => r.from.trim() || r.to.trim());
    relationships.forEach((r, i) => {
      if (!r.from.trim() || !r.to.trim())
        issues.push({ severity: 'error', message: `Relationship ${i + 1} needs both a source and a target class.`, location: `relationships.${i}` });
    });
    if (issues.length > 0) return { issues };

    const built = DesignModel.build({ classes, relationships });
    return { model: built.model, issues: built.issues };
  }
}

function isBlankCard(c: z.infer<typeof ClassCard>): boolean {
  return (
    !c.name.trim() &&
    !c.responsibility.trim() &&
    c.attributes.every((a) => !a.trim()) &&
    c.methods.every((m) => !m.trim())
  );
}
