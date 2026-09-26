import type { ClassKind, DesignModelDto, RelationKind } from '../../../shared/contracts';

/** Characters that would break Mermaid's class-diagram syntax if they appeared in learner text. */
const unsafe = /[{}<>~"`]|%%/g;
const clean = (text: string, max = 60): string => text.replace(unsafe, '').replace(/\s+/g, ' ').trim().slice(0, max);

const ANNOTATION: Partial<Record<ClassKind, string>> = { interface: 'interface', abstract: 'abstract', enum: 'enumeration' };

/** From→to relationship as a Mermaid arrow. Mermaid puts the parent/whole on the left for these kinds. */
function arrow(kind: RelationKind, from: string, to: string): string {
  switch (kind) {
    case 'inheritance': return `${to} <|-- ${from}`;
    case 'realization': return `${to} <|.. ${from}`;
    case 'composition': return `${from} *-- ${to}`;
    case 'aggregation': return `${from} o-- ${to}`;
    case 'association': return `${from} --> ${to}`;
    case 'dependency': return `${from} ..> ${to}`;
  }
}

export interface MermaidOptions {
  /** Add `note for X "responsibility"` lines, the form the Mermaid submission format reads back. */
  responsibilityNotes?: boolean;
}

/** Render a parsed design as Mermaid classDiagram text (for preview, and for converting between formats). */
export function toMermaid(model: DesignModelDto, options: MermaidOptions = {}): string {
  const lines = ['classDiagram'];
  for (const c of model.classes) {
    const members = [...c.attributes.map((a) => clean(a)), ...c.methods.map((m) => clean(m))].filter(Boolean);
    const annotation = ANNOTATION[c.kind];
    if (annotation || members.length > 0) {
      lines.push(`  class ${c.name} {`);
      if (annotation) lines.push(`    <<${annotation}>>`);
      members.forEach((m) => lines.push(`    ${m}`));
      lines.push('  }');
    } else {
      lines.push(`  class ${c.name}`);
    }
  }
  for (const r of model.relationships) {
    const label = clean(r.label ?? '', 40);
    lines.push(`  ${arrow(r.kind, r.from, r.to)}${label ? ` : ${label}` : ''}`);
  }
  if (options.responsibilityNotes) {
    for (const c of model.classes) {
      const text = c.responsibility.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
      if (text) lines.push(`  note for ${c.name} "${text}"`);
    }
  }
  return lines.join('\n');
}

/** A parsed design as CRC-card payload, for converting from Mermaid to cards. */
export function toCardPayload(model: DesignModelDto): { classes: DesignModelDto['classes']; relationships: DesignModelDto['relationships'] } {
  return {
    classes: model.classes.map((c) => ({ ...c, attributes: [...c.attributes], methods: [...c.methods] })),
    relationships: model.relationships.map((r) => ({ ...r })),
  };
}

export interface CardPayload {
  classes: { name: string; kind: ClassKind; responsibility: string; attributes: string[]; methods: string[] }[];
  relationships: { from: string; to: string; kind: RelationKind; label: string }[];
}

export const emptyCard = (): CardPayload['classes'][number] => ({ name: '', kind: 'class', responsibility: '', attributes: [], methods: [] });

/** Whether a design payload holds any of the learner's work (so switching format should ask first). */
export function hasContent(format: string, design: unknown): boolean {
  if (!design || typeof design !== 'object') return false;
  if (format === 'crc-cards') {
    const d = design as Partial<CardPayload>;
    return (d.classes ?? []).some((c) => c.name?.trim() || c.responsibility?.trim());
  }
  if (format === 'mermaid-class') {
    const src = String((design as { source?: string }).source ?? '');
    return src.split('\n').some((l) => l.trim() && !l.trim().startsWith('%%') && l.trim() !== 'classDiagram');
  }
  return true;
}
