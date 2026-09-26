import { CrcEditor } from './CrcEditor';
import { JsonEditor } from './JsonEditor';
import { MermaidEditor } from './MermaidEditor';
import type { Editor } from './types';

/**
 * Which editor edits which submission format. To add a format: implement SubmissionFormat on the server,
 * and (optionally) register a nicer editor here. Without one, the JSON editor is used.
 */
const EDITORS: Record<string, Editor> = {
  'crc-cards': CrcEditor,
  'mermaid-class': MermaidEditor,
};

export const editorFor = (formatId: string): Editor => EDITORS[formatId] ?? JsonEditor;
