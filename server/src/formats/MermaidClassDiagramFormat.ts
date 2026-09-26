import { z } from 'zod';
import type { ClassKind, ParseIssueDto, RelationKind } from '../../../shared/contracts';
import { DesignModel } from '../domain/design/DesignModel';
import type { ParseOutcome, SubmissionFormat } from './SubmissionFormat';

const Payload = z.object({ source: z.string().max(30_000) });

interface MutableClass {
  name: string;
  kind: ClassKind;
  notes: string[];
  attributes: string[];
  methods: string[];
}

type Link = { from: string; to: string; kind: RelationKind };

/** Maps a Mermaid arrow to a directed relationship, given the names written on its left (a) and right (b). */
const ARROWS: Record<string, (a: string, b: string) => Link> = {
  '<|--': (a, b) => ({ from: b, to: a, kind: 'inheritance' }),
  '--|>': (a, b) => ({ from: a, to: b, kind: 'inheritance' }),
  '<|..': (a, b) => ({ from: b, to: a, kind: 'realization' }),
  '..|>': (a, b) => ({ from: a, to: b, kind: 'realization' }),
  '*--': (a, b) => ({ from: a, to: b, kind: 'composition' }),
  '--*': (a, b) => ({ from: b, to: a, kind: 'composition' }),
  'o--': (a, b) => ({ from: a, to: b, kind: 'aggregation' }),
  '--o': (a, b) => ({ from: b, to: a, kind: 'aggregation' }),
  '-->': (a, b) => ({ from: a, to: b, kind: 'association' }),
  '<--': (a, b) => ({ from: b, to: a, kind: 'association' }),
  '..>': (a, b) => ({ from: a, to: b, kind: 'dependency' }),
  '<..': (a, b) => ({ from: b, to: a, kind: 'dependency' }),
  '--': (a, b) => ({ from: a, to: b, kind: 'association' }),
  '..': (a, b) => ({ from: a, to: b, kind: 'dependency' }),
};

const ARROW_ALTERNATION = Object.keys(ARROWS)
  .sort((x, y) => y.length - x.length)
  .map((a) => a.replace(/[|*.]/g, (c) => `\\${c}`))
  .join('|');

const RELATION = new RegExp(
  `^(\\w+)\\s*(?:"[^"]*"\\s*)?(${ARROW_ALTERNATION})\\s*(?:"[^"]*"\\s*)?(\\w+)\\s*(?::\\s*(.+))?$`,
);
const CLASS_WITH_BODY = /^class\s+(\w+)(?:~[^~]*~)?(?:\s*\["[^"]*"\])?\s*\{\s*$/;
const CLASS_INLINE = /^class\s+(\w+)(?:~[^~]*~)?(?:\s*\["[^"]*"\])?(?:\s*\{\s*\})?$/;
const ANNOTATION = /^<<\s*(\w+)\s*>>$/;
const ANNOTATION_FOR = /^<<\s*(\w+)\s*>>\s+(\w+)$/;
const NOTE_FOR = /^note\s+for\s+(\w+)\s+"(.*)"$/;
const MEMBER = /^(\w+)\s*:\s*(.+)$/;

/**
 * Mermaid `classDiagram` text. Many learners already draw designs this way, and it can be written
 * in any editor. Responsibilities, which Mermaid has no syntax for, are captured from
 * `note for ClassName "responsibility"` lines.
 *
 * Supported: class declarations (with or without bodies), members, <<interface>>/<<abstract>>/<<enumeration>>
 * annotations, all relationship arrows, cardinality strings, labels, and notes. Anything else is reported
 * as an ignored-line warning rather than silently dropped.
 */
export class MermaidClassDiagramFormat implements SubmissionFormat {
  readonly id = 'mermaid-class';
  readonly label = 'Mermaid class diagram';
  readonly description =
    'Write a Mermaid classDiagram. Add `note for ClassName "what it is responsible for"` so reviewers can judge responsibilities.';

  starter(): unknown {
    return {
      source: [
        'classDiagram',
        '  %% 1. Declare classes:  class Name { +method() }   (use <<interface>> or <<abstract>> inside the body)',
        '  %% 2. Relate them:      Parent <|-- Child    Iface <|.. Impl    Whole *-- Part    A --> B    A ..> B',
        '  %% 3. State what each owns:  note for Name "One sentence: what this class is responsible for"',
        '',
      ].join('\n'),
    };
  }

  parse(payload: unknown): ParseOutcome {
    const parsed = Payload.safeParse(payload);
    if (!parsed.success) {
      return { issues: [{ severity: 'error', message: 'Provide the diagram as { "source": "<mermaid text>" }.' }] };
    }

    const issues: ParseIssueDto[] = [];
    const classes = new Map<string, MutableClass>();
    const links: (Link & { label: string })[] = [];

    const ensure = (name: string): MutableClass => {
      const key = name.toLowerCase();
      let c = classes.get(key);
      if (!c) {
        c = { name, kind: 'class', notes: [], attributes: [], methods: [] };
        classes.set(key, c);
      }
      return c;
    };
    const addMember = (c: MutableClass, text: string) => {
      const member = text.trim();
      if (!member) return;
      (member.includes('(') ? c.methods : c.attributes).push(member);
    };
    const applyAnnotation = (c: MutableClass, raw: string) => {
      const a = raw.toLowerCase();
      if (a === 'interface') c.kind = 'interface';
      else if (a === 'abstract') c.kind = 'abstract';
      else if (a === 'enumeration' || a === 'enum') c.kind = 'enum';
    };

    let sawHeader = false;
    let body: MutableClass | null = null;

    const lines = parsed.data.source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const line = lines[i]!.replace(/%%.*$/, '').trim();
      if (!line) continue;
      const loc = `line ${lineNo}`;

      if (!sawHeader) {
        if (/^classDiagram(-v2)?$/.test(line)) {
          sawHeader = true;
          continue;
        }
        issues.push({ severity: 'error', message: 'The diagram must start with `classDiagram`.', location: loc });
        break;
      }

      if (body) {
        if (line === '}') {
          body = null;
        } else if (ANNOTATION.test(line)) {
          applyAnnotation(body, ANNOTATION.exec(line)![1]!);
        } else {
          addMember(body, line);
        }
        continue;
      }

      let m: RegExpExecArray | null;
      if (/^direction\s+(TB|BT|LR|RL)$/.test(line)) continue;
      if ((m = CLASS_WITH_BODY.exec(line))) {
        body = ensure(m[1]!);
        continue;
      }
      if ((m = CLASS_INLINE.exec(line))) {
        ensure(m[1]!);
        continue;
      }
      if ((m = ANNOTATION_FOR.exec(line))) {
        applyAnnotation(ensure(m[2]!), m[1]!);
        continue;
      }
      if ((m = NOTE_FOR.exec(line))) {
        ensure(m[1]!).notes.push(m[2]!.trim());
        continue;
      }
      if ((m = RELATION.exec(line))) {
        const a = ensure(m[1]!).name;
        const b = ensure(m[3]!).name;
        links.push({ ...ARROWS[m[2]!]!(a, b), label: (m[4] ?? '').trim() });
        continue;
      }
      if ((m = MEMBER.exec(line))) {
        addMember(ensure(m[1]!), m[2]!);
        continue;
      }
      issues.push({ severity: 'warning', message: `Ignored: \`${line.slice(0, 60)}\` is not supported here.`, location: loc });
    }

    if (body) issues.push({ severity: 'error', message: `Class '${body.name}' is missing its closing brace.` });
    if (!sawHeader && !issues.some((i) => i.severity === 'error')) {
      issues.push({ severity: 'error', message: 'The diagram must start with `classDiagram`.' });
    }
    if (issues.some((i) => i.severity === 'error')) return { issues };

    const built = DesignModel.build({
      classes: [...classes.values()].map((c) => ({
        name: c.name,
        kind: c.kind,
        responsibility: c.notes.join(' '),
        attributes: c.attributes,
        methods: c.methods,
      })),
      relationships: links,
    });
    return { model: built.model, issues: [...issues, ...built.issues] };
  }
}
