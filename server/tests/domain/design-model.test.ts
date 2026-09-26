import { describe, it, expect } from 'vitest';
import { DesignModel } from '../../src/domain/design/DesignModel';
import { ConceptMatcher } from '../../src/domain/design/ConceptMatcher';
import { stem, conceptMatches, words } from '../../src/domain/text';

const build = (classes: any[], relationships: any[] = []) => DesignModel.build({ classes, relationships });

describe('DesignModel.build', () => {
  it('builds a valid model and canonicalises relationship endpoints', () => {
    const { model, issues } = build(
      [{ name: 'Vehicle', kind: 'abstract' }, { name: 'Car' }],
      [{ from: 'car', to: 'VEHICLE', kind: 'inheritance' }],
    );
    expect(issues).toEqual([]);
    expect(model!.relationships[0]).toMatchObject({ from: 'Car', to: 'Vehicle' });
  });

  it('rejects an empty design', () => {
    const { model, issues } = build([]);
    expect(model).toBeUndefined();
    expect(issues[0]!.message).toMatch(/at least one class/i);
  });

  it('rejects invalid identifiers and duplicate names (case-insensitively)', () => {
    const { model, issues } = build([{ name: 'Parking Lot' }, { name: 'Spot' }, { name: 'spot' }]);
    expect(model).toBeUndefined();
    expect(issues.map((i) => i.message).join('\n')).toMatch(/not a valid class name/);
    expect(issues.map((i) => i.message).join('\n')).toMatch(/declared more than once/);
  });

  it('rejects relationships that point at undeclared classes', () => {
    const { model, issues } = build([{ name: 'A' }], [{ from: 'A', to: 'Ghost', kind: 'association' }]);
    expect(model).toBeUndefined();
    expect(issues[0]!.message).toMatch(/'Ghost', which is not a class/);
  });

  it('rejects self-inheritance and inheritance cycles, but allows a self-association', () => {
    expect(build([{ name: 'A' }], [{ from: 'A', to: 'A', kind: 'inheritance' }]).model).toBeUndefined();

    const cyc = build(
      [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      [
        { from: 'A', to: 'B', kind: 'inheritance' },
        { from: 'B', to: 'C', kind: 'inheritance' },
        { from: 'C', to: 'A', kind: 'inheritance' },
      ],
    );
    expect(cyc.model).toBeUndefined();
    expect(cyc.issues[0]!.message).toMatch(/Inheritance cycle: A → B → C → A/);

    expect(build([{ name: 'Node' }], [{ from: 'Node', to: 'Node', kind: 'association' }]).model).toBeDefined();
  });

  it('enforces size limits', () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ name: `C${i}` }));
    expect(build(many).issues[0]!.message).toMatch(/at most 40 classes/);
    const longResp = build([{ name: 'A', responsibility: 'x'.repeat(401) }]);
    expect(longResp.model).toBeUndefined();
  });

  it('ignores exact duplicate relationships', () => {
    const { model } = build(
      [{ name: 'A' }, { name: 'B' }],
      [{ from: 'A', to: 'B', kind: 'association' }, { from: 'A', to: 'B', kind: 'association' }],
    );
    expect(model!.relationships).toHaveLength(1);
  });
});

describe('DesignModel queries', () => {
  const { model } = build(
    [
      { name: 'PricingStrategy', kind: 'interface' },
      { name: 'HourlyPricing' },
      { name: 'FlatPricing' },
      { name: 'Ticket' },
      { name: 'Lot' },
      { name: 'Orphan' },
    ],
    [
      { from: 'HourlyPricing', to: 'PricingStrategy', kind: 'realization' },
      { from: 'FlatPricing', to: 'PricingStrategy', kind: 'realization' },
      { from: 'Lot', to: 'Ticket', kind: 'composition' },
      { from: 'Ticket', to: 'Lot', kind: 'association' },
    ],
  );

  it('finds implementors, collaborators and clients', () => {
    expect(model!.subtypesOf('PricingStrategy').map((c) => c.name).sort()).toEqual(['FlatPricing', 'HourlyPricing']);
    expect(model!.supertypesOf('FlatPricing').map((c) => c.name)).toEqual(['PricingStrategy']);
    expect(model!.collaboratorsOf('Lot').map((c) => c.name)).toEqual(['Ticket']);
    expect(model!.clientsOf('Ticket').map((c) => c.name)).toEqual(['Lot']);
  });

  it('reports isolated classes and usage cycles', () => {
    expect(model!.isolatedClasses().map((c) => c.name)).toEqual(['Orphan']);
    const cycles = model!.usageCycles();
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.sort()).toEqual(['Lot', 'Ticket']);
  });

  it('computes inheritance depth', () => {
    const { model: m } = build(
      [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
      [
        { from: 'B', to: 'A', kind: 'inheritance' },
        { from: 'C', to: 'B', kind: 'inheritance' },
        { from: 'D', to: 'C', kind: 'inheritance' },
      ],
    );
    expect(m!.inheritanceDepth('A')).toBe(0);
    expect(m!.inheritanceDepth('D')).toBe(3);
  });

  it('round-trips through its DTO', () => {
    expect(DesignModel.fromDto(model!.toDto()).toDto()).toEqual(model!.toDto());
  });
});

describe('vocabulary matching', () => {
  it('splits identifiers and stems plurals', () => {
    expect(words('SpotAllocationStrategy')).toEqual(['spot', 'allocation', 'strategy']);
    expect(words('EVCharger')).toEqual(['ev', 'charger']);
    expect(stem('strategies')).toBe('strategy');
    expect(stem('tickets')).toBe('ticket');
  });

  it('matches related word forms but not accidental prefixes', () => {
    expect(conceptMatches('price', 'pricing')).toBe(true);
    expect(conceptMatches('assign', 'assignment')).toBe(true);
    expect(conceptMatches('car', 'car')).toBe(true);
    expect(conceptMatches('car', 'card')).toBe(false);
    expect(conceptMatches('spot', 'spotify')).toBe(true); // documented limitation of prefix matching
  });

  it('accepts several valid namings for one concept', () => {
    const { model } = build([{ name: 'TariffPolicy' }, { name: 'Lot', responsibility: 'Charges a fee on exit' }]);
    const matcher = new ConceptMatcher(model!);
    const m = matcher.match(['fee', 'tariff', 'pricing']);
    expect(m.map((x) => `${x.cls.name}:${x.via}`).sort()).toEqual(['Lot:text', 'TariffPolicy:name']);
    expect(matcher.named(['fee', 'tariff']).map((c) => c.name)).toEqual(['TariffPolicy']);
  });
});
