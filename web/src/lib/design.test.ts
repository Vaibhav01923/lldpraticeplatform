import { describe, it, expect } from 'vitest';
import { MermaidClassDiagramFormat } from '../../../server/src/formats/MermaidClassDiagramFormat';
import { DesignModel } from '../../../server/src/domain/design/DesignModel';
import { formatDelta } from './labels';
import { hasContent, toMermaid } from './design';

const model = DesignModel.build({
  classes: [
    { name: 'PricingStrategy', kind: 'interface', responsibility: 'Computes the "fee" for a ticket', methods: ['fee(ticket)'] },
    { name: 'HourlyPricing', kind: 'class', responsibility: 'Charges per started hour' },
    { name: 'Lot', kind: 'class', responsibility: '', attributes: ['levels'] },
    { name: 'Vehicle', kind: 'abstract' },
    { name: 'Car' },
    { name: 'Size', kind: 'enum' },
  ],
  relationships: [
    { from: 'HourlyPricing', to: 'PricingStrategy', kind: 'realization' },
    { from: 'Car', to: 'Vehicle', kind: 'inheritance' },
    { from: 'Lot', to: 'PricingStrategy', kind: 'association', label: 'prices with' },
    { from: 'Lot', to: 'Car', kind: 'dependency' },
    { from: 'Lot', to: 'Size', kind: 'aggregation' },
    { from: 'Lot', to: 'Vehicle', kind: 'composition' },
  ],
}).model!.toDto();

describe('toMermaid', () => {
  it('renders every relationship kind with the arrow the server parser reads back', () => {
    const text = toMermaid(model, { responsibilityNotes: true });
    const reparsed = new MermaidClassDiagramFormat().parse({ source: text });
    expect(reparsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const original = model.relationships.map((r) => `${r.from}|${r.to}|${r.kind}`).sort();
    const roundTrip = reparsed.model!.relationships.map((r) => `${r.from}|${r.to}|${r.kind}`).sort();
    expect(roundTrip).toEqual(original);
  });

  it('round-trips classes, kinds, members and responsibilities', () => {
    const reparsed = new MermaidClassDiagramFormat().parse({ source: toMermaid(model, { responsibilityNotes: true }) }).model!;
    expect(reparsed.classes.map((c) => [c.name, c.kind]).sort()).toEqual(model.classes.map((c) => [c.name, c.kind]).sort());
    expect(reparsed.find('PricingStrategy')!.methods).toEqual(['fee(ticket)']);
    expect(reparsed.find('Lot')!.attributes).toEqual(['levels']);
    expect(reparsed.find('HourlyPricing')!.responsibility).toBe('Charges per started hour');
    expect(reparsed.find('PricingStrategy')!.responsibility).toBe("Computes the 'fee' for a ticket");
  });

  it('omits notes unless asked, and never emits characters that break Mermaid syntax', () => {
    expect(toMermaid(model)).not.toContain('note for');
    const nasty = DesignModel.build({ classes: [{ name: 'A', attributes: ['x: List<Map<K,V>> {y}', 'z ~T~ "q"'] }], relationships: [] }).model!.toDto();
    const text = toMermaid(nasty);
    expect(text).not.toMatch(/[<>~"{}]\s*[<>~"]/);
    expect(new MermaidClassDiagramFormat().parse({ source: text }).issues).toEqual([]);
  });
});

describe('hasContent', () => {
  it('spots real work in either format, and ignores untouched starters', () => {
    expect(hasContent('crc-cards', { classes: [], relationships: [] })).toBe(false);
    expect(hasContent('crc-cards', { classes: [{ name: '', responsibility: '' }] })).toBe(false);
    expect(hasContent('crc-cards', { classes: [{ name: 'A' }] })).toBe(true);
    expect(hasContent('mermaid-class', { source: 'classDiagram\n  %% hint\n' })).toBe(false);
    expect(hasContent('mermaid-class', { source: 'classDiagram\n  class A' })).toBe(true);
    expect(hasContent('some-new-format', {})).toBe(true);
  });
});

describe('formatDelta', () => {
  it('signs and rounds', () => {
    expect([formatDelta(1.25), formatDelta(-0.5), formatDelta(0)]).toEqual(['+1.3', '−0.5', '±0']);
  });
});
