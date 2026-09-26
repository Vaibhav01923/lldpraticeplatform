import { describe, it, expect } from 'vitest';
import { CrcCardsFormat } from '../../src/formats/CrcCardsFormat';
import { MermaidClassDiagramFormat } from '../../src/formats/MermaidClassDiagramFormat';
import { FormatRegistry } from '../../src/formats/SubmissionFormat';
import { defaultFormats } from '../../src/formats';

describe('CrcCardsFormat', () => {
  const format = new CrcCardsFormat();

  it('parses cards and relationships into a model', () => {
    const out = format.parse({
      classes: [
        { name: 'Ticket', responsibility: 'Records entry time', methods: ['duration()'] },
        { name: 'Lot', kind: 'class', responsibility: 'Issues tickets' },
      ],
      relationships: [{ from: 'Lot', to: 'Ticket', kind: 'composition' }],
    });
    expect(out.issues).toEqual([]);
    expect(out.model!.find('Ticket')!.methods).toEqual(['duration()']);
    expect(out.model!.relationships).toHaveLength(1);
  });

  it('silently drops untouched blank cards and rows', () => {
    const out = format.parse({
      classes: [{ name: 'A' }, { name: '', responsibility: '' }],
      relationships: [{ from: '', to: '' }],
    });
    expect(out.issues).toEqual([]);
    expect(out.model!.classes).toHaveLength(1);
  });

  it('reports a card with content but no name, and half-filled relationships', () => {
    const out = format.parse({
      classes: [{ name: 'A' }, { name: '', responsibility: 'does things' }],
      relationships: [{ from: 'A', to: '' }],
    });
    expect(out.model).toBeUndefined();
    expect(out.issues.map((i) => i.message).join('\n')).toMatch(/has content but no name/);
    expect(out.issues.map((i) => i.message).join('\n')).toMatch(/needs both a source and a target/);
  });

  it('rejects malformed payloads without throwing', () => {
    expect(format.parse('nonsense').model).toBeUndefined();
    expect(format.parse({ classes: [{ name: 'A', kind: 'struct' }] }).issues[0]!.severity).toBe('error');
    expect(format.parse(null).issues.length).toBeGreaterThan(0);
  });
});

describe('MermaidClassDiagramFormat', () => {
  const format = new MermaidClassDiagramFormat();
  const parse = (source: string) => format.parse({ source });

  it('parses classes, members, annotations, relationships and responsibility notes', () => {
    const out = parse(`
classDiagram
  class PricingStrategy {
    <<interface>>
    +calculate(Ticket) Money
  }
  class HourlyPricing
  class Ticket {
    -entryTime: Date
    +duration() int
  }
  PricingStrategy <|.. HourlyPricing
  Lot "1" *-- "many" Ticket : issues
  Lot ..> PricingStrategy : uses
  Ticket : +vehiclePlate String
  note for Lot "Issues tickets and assigns spots"
  %% a comment
`);
    expect(out.issues).toEqual([]);
    const m = out.model!;
    expect(m.find('PricingStrategy')).toMatchObject({ kind: 'interface', methods: ['+calculate(Ticket) Money'] });
    expect(m.find('Ticket')!.attributes).toEqual(['-entryTime: Date', '+vehiclePlate String']);
    expect(m.find('Lot')!.responsibility).toBe('Issues tickets and assigns spots');
    const rels = m.relationships.map((r) => r.ref).sort();
    expect(rels).toEqual([
      'HourlyPricing --realization--> PricingStrategy',
      'Lot --composition--> Ticket',
      'Lot --dependency--> PricingStrategy',
    ]);
  });

  it('interprets arrow direction: "Parent <|-- Child" means Child extends Parent', () => {
    const m = parse('classDiagram\n  Animal <|-- Dog\n  Cat --|> Animal\n  Engine --* Car\n  Wheel --o Car').model!;
    expect(m.relationships.map((r) => r.ref).sort()).toEqual([
      'Car --aggregation--> Wheel',
      'Car --composition--> Engine',
      'Cat --inheritance--> Animal',
      'Dog --inheritance--> Animal',
    ]);
  });

  it('creates classes implicitly from relationships, like Mermaid does', () => {
    const m = parse('classDiagram\n  A --> B').model!;
    expect(m.classes.map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('errors without the classDiagram header', () => {
    const out = parse('graph TD\n  A --> B');
    expect(out.model).toBeUndefined();
    expect(out.issues[0]).toMatchObject({ severity: 'error', location: 'line 1' });
  });

  it('errors on an unclosed class body', () => {
    const out = parse('classDiagram\n  class A {\n    +x()');
    expect(out.model).toBeUndefined();
    expect(out.issues[0]!.message).toMatch(/missing its closing brace/);
  });

  it('warns on, rather than silently drops, unsupported lines', () => {
    const out = parse('classDiagram\n  class A\n  click A callback "tip"\n');
    expect(out.model).toBeDefined();
    expect(out.issues).toEqual([expect.objectContaining({ severity: 'warning', location: 'line 3' })]);
  });

  it('propagates model-level errors such as inheritance cycles', () => {
    const out = parse('classDiagram\n  A <|-- B\n  B <|-- A');
    expect(out.model).toBeUndefined();
    expect(out.issues.some((i) => /Inheritance cycle/.test(i.message))).toBe(true);
  });

  it('the starter is a valid document that yields a clear "add a class" error', () => {
    const out = format.parse(format.starter());
    expect(out.model).toBeUndefined();
    expect(out.issues[0]!.message).toMatch(/at least one class/i);
  });
});

describe('FormatRegistry', () => {
  it('lists formats with starters and rejects unknown ids and duplicates', () => {
    const registry = defaultFormats();
    expect(registry.list().map((f) => f.id)).toEqual(['crc-cards', 'mermaid-class']);
    expect(() => registry.get('plantuml')).toThrow(/Unknown submission format 'plantuml'/);
    expect(() => registry.register(new CrcCardsFormat())).toThrow(/Duplicate/);
  });

  it('a new format plugs in without touching anything else', () => {
    const registry = new FormatRegistry();
    registry.register({
      id: 'one-liner',
      label: 'One class',
      description: 'test',
      starter: () => ({}),
      parse: () => ({ issues: [] }),
    });
    expect(registry.get('one-liner').label).toBe('One class');
  });
});
