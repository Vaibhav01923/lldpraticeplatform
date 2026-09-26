import { CrcCardsFormat } from './CrcCardsFormat';
import { MermaidClassDiagramFormat } from './MermaidClassDiagramFormat';
import { FormatRegistry } from './SubmissionFormat';

/** The formats this build ships with. Register another one here to offer it to learners. */
export function defaultFormats(): FormatRegistry {
  return new FormatRegistry([new CrcCardsFormat(), new MermaidClassDiagramFormat()]);
}

export * from './SubmissionFormat';
export { CrcCardsFormat } from './CrcCardsFormat';
export { MermaidClassDiagramFormat } from './MermaidClassDiagramFormat';
