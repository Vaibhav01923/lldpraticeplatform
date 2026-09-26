import { describe, it, expect } from 'vitest';
import { RuleBasedEvaluator } from '../../src/evaluation/rules/RuleBasedEvaluator';
import type { EvaluatorResult } from '../../src/evaluation/Evaluator';
import { crcSubmission, contextFor, card, goodParkingLotPayload, weakParkingLotPayload, mermaidSubmission, goodAnswers } from '../helpers/fixtures';
import { vendingMachine } from '../../src/problems/vendingMachine';

const run = (s = crcSubmission(), problem?: Parameters<typeof contextFor>[1]): Promise<EvaluatorResult> =>
  new RuleBasedEvaluator().evaluate(contextFor(s, problem));
const ids = (r: EvaluatorResult) => r.findings.map((f) => f.id);
const score = (r: EvaluatorResult, d: string) => r.assessments.find((a) => a.dimension === d)!.score;

describe('RuleBasedEvaluator on a strong design', () => {
  it('scores every dimension high and raises no major or critical findings', async () => {
    const r = await run();
    for (const a of r.assessments) expect(a.score, a.dimension).toBeGreaterThanOrEqual(3.3);
    const serious = r.findings.filter((f) => f.severity === 'major' || f.severity === 'critical');
    expect(serious, JSON.stringify(serious.map((f) => f.title))).toEqual([]);
  });

  it('recognises each strength and full coverage', async () => {
    const r = await run();
    const strengths = r.findings.filter((f) => f.severity === 'strength').map((f) => f.ruleId);
    expect(strengths).toEqual(
      expect.arrayContaining(['all-capabilities-covered', 'responsibilities-stated-ok', 'variability-handled', 'scenarios-grounded', 'assumptions-stated', 'tradeoffs-articulated']),
    );
    expect(r.coverage!.every((c) => c.status === 'covered')).toBe(true);
  });

  it('is deterministic: identical input gives identical output', async () => {
    expect(await run()).toEqual(await run());
  });
});

describe('RuleBasedEvaluator on a weak design', () => {
  const weak = () => crcSubmission({ payload: weakParkingLotPayload, assumptions: '', decisions: 'Used a manager.', answers: {} });

  it('flags the overloaded class, vague names, missing owners, and unanswered scenarios', async () => {
    const r = await run(weak());
    expect(ids(r)).toEqual(
      expect.arrayContaining([
        'god-class:ParkingManager',
        'vague-names',
        'responsibilities-stated',
        'implicit-capability:pricing',
        'implicit-capability:payment',
        'scenario-unanswered:S1',
        'scenario-unanswered:S2',
        'scenario-unanswered:S3',
        'assumptions-missing',
        'tradeoffs-missing',
      ]),
    );
  });

  it('scores clearly lower than the strong design, with capped requirements coverage', async () => {
    const strong = await run();
    const r = await run(weak());
    for (const a of r.assessments) expect(a.score, a.dimension).toBeLessThan(score(strong, a.dimension));
    expect(score(r, 'communication')).toBeLessThan(1);
    expect(r.caps!.some((c) => c.dimension === 'requirements')).toBe(true);
  });

  it('gives an actionable suggestion on every non-strength finding', async () => {
    const r = await run(weak());
    for (const f of r.findings.filter((f) => f.severity !== 'strength')) {
      expect(f.suggestion, f.id).toBeTruthy();
      expect(f.detail.length, f.id).toBeGreaterThan(20);
    }
  });
});

describe('individual rules', () => {
  it('caps every dimension when the design has fewer than three classes', async () => {
    const r = await run(crcSubmission({ payload: { classes: [card('A', 'class', 'does a thing'), card('B', 'class', 'does another thing')], relationships: [] } }));
    expect(ids(r)).toContain('design-too-small');
    expect(r.caps).toContainEqual(expect.objectContaining({ dimension: 'all', max: 1.5 }));
  });

  it('accepts several valid names for one concept (alternative designs)', async () => {
    const payload = structuredClone(goodParkingLotPayload);
    payload.classes.find((c) => c.name === 'PricingStrategy')!.name = 'TariffPolicy';
    payload.classes.find((c) => c.name === 'HourlyPricing')!.name = 'PerHourTariff';
    payload.classes.find((c) => c.name === 'FlatPricing')!.name = 'FlatTariff';
    for (const r of payload.relationships) {
      if (r.to === 'PricingStrategy') r.to = 'TariffPolicy';
      if (r.from === 'HourlyPricing') r.from = 'PerHourTariff';
      if (r.from === 'FlatPricing') r.from = 'FlatTariff';
    }
    const result = await run(crcSubmission({ payload }));
    expect(ids(result)).not.toContain('missing-capability:pricing');
    expect(result.coverage!.find((c) => c.id === 'pricing')!.status).toBe('covered');
  });

  it('marks a capability as partial when it is only described inside another class', async () => {
    const payload = structuredClone(goodParkingLotPayload);
    payload.classes = payload.classes.filter((c) => !['PricingStrategy', 'HourlyPricing', 'FlatPricing'].includes(c.name));
    payload.relationships = payload.relationships.filter((r) => !['PricingStrategy', 'HourlyPricing', 'FlatPricing'].some((n) => r.from === n || r.to === n));
    payload.classes.find((c) => c.name === 'Ticket')!.methods = ['calculateFee()'];
    const r = await run(crcSubmission({ payload }));
    expect(r.coverage!.find((c) => c.id === 'pricing')!.status).toBe('partial');
    expect(ids(r)).toContain('implicit-capability:pricing');
    expect(ids(r)).toContain('variability-inline:pricing');
  });

  it('flags an abstraction with no implementations, and a dependency on a concrete class that has an interface', async () => {
    const payload = structuredClone(goodParkingLotPayload);
    payload.classes.push(card('Notifier', 'interface', 'Tells the driver something'));
    payload.relationships.push({ from: 'ExitGate', to: 'Notifier', kind: 'association' });
    payload.relationships.push({ from: 'ParkingLot', to: 'CashPayment', kind: 'association' });
    const r = await run(crcSubmission({ payload }));
    expect(ids(r)).toContain('dead-abstraction:Notifier');
    expect(ids(r)).toContain('concrete-dependency:ParkingLot>CashPayment');
    // ExitGate already depends on the PaymentMethod abstraction, so it is not flagged for it.
    expect(ids(r).some((id) => id.startsWith('concrete-dependency:ExitGate'))).toBe(false);
  });

  it('flags circular dependencies (two-way as minor, three-way as major)', async () => {
    const two = structuredClone(goodParkingLotPayload);
    two.relationships.push({ from: 'ParkingSpot', to: 'Level', kind: 'association' });
    const r2 = await run(crcSubmission({ payload: two }));
    const twoWay = r2.findings.find((f) => f.ruleId === 'mutual-dependency')!;
    expect(twoWay).toMatchObject({ severity: 'minor', confidence: 'low' });

    const three = structuredClone(goodParkingLotPayload);
    three.relationships.push({ from: 'Ticket', to: 'ExitGate', kind: 'association' }, { from: 'ExitGate', to: 'Ticket', kind: 'association' });
    three.relationships.push({ from: 'ParkingSpot', to: 'ParkingLot', kind: 'association' }, { from: 'ParkingLot', to: 'ParkingSpot', kind: 'association' });
    const r3 = await run(crcSubmission({ payload: three }));
    expect(r3.findings.filter((f) => f.ruleId === 'mutual-dependency').length).toBeGreaterThan(0);
  });

  it('flags deep inheritance', async () => {
    const payload = structuredClone(goodParkingLotPayload);
    payload.classes.push(card('SmallCar', 'class', 'A small car'), card('MiniCar', 'class', 'A mini car'), card('MicroCar', 'class', 'A micro car'));
    payload.relationships.push({ from: 'SmallCar', to: 'Car', kind: 'inheritance' }, { from: 'MiniCar', to: 'SmallCar', kind: 'inheritance' }, { from: 'MicroCar', to: 'MiniCar', kind: 'inheritance' });
    const r = await run(crcSubmission({ payload }));
    const f = r.findings.find((f) => f.ruleId === 'deep-inheritance')!;
    expect(f.severity).toBe('major');
    expect(f.evidence.map((e) => e.ref)).toEqual(['MicroCar', 'MiniCar', 'SmallCar', 'Car', 'Vehicle']);
  });

  it('flags an isolated class, but ignores unlinked enums', async () => {
    const payload = structuredClone(goodParkingLotPayload);
    payload.classes.push(card('Orphan', 'class', 'Does something unrelated'), card('SpotSize', 'enum', 'Sizes of spots'));
    const r = await run(crcSubmission({ payload }));
    const f = r.findings.find((f) => f.ruleId === 'isolated-classes')!;
    expect(f.evidence.map((e) => e.ref)).toEqual(['Orphan']);
  });

  it('accepts an enum for an enum-friendly variation point, but not a lone concrete class', async () => {
    const enumOk = structuredClone(goodParkingLotPayload);
    enumOk.classes = enumOk.classes.filter((c) => !['Car', 'Motorcycle', 'Truck'].includes(c.name));
    enumOk.classes = enumOk.classes.map((c) => (c.name === 'Vehicle' ? card('Vehicle', 'class', 'A vehicle with a type', [], ['type']) : c));
    enumOk.classes.push(card('VehicleType', 'enum', 'The kinds of vehicle'));
    enumOk.relationships = enumOk.relationships.filter((r) => !['Car', 'Motorcycle', 'Truck'].includes(r.from));
    enumOk.relationships.push({ from: 'Vehicle', to: 'VehicleType', kind: 'association' });
    const r = await run(crcSubmission({ payload: enumOk }));
    expect(ids(r)).not.toContain('concrete-variation:vehicle');
    expect(ids(r)).not.toContain('type-field:vehicle');

    const pricingConcrete = structuredClone(goodParkingLotPayload);
    pricingConcrete.classes = pricingConcrete.classes.filter((c) => !['PricingStrategy', 'HourlyPricing', 'FlatPricing'].includes(c.name));
    pricingConcrete.classes.push(card('PricingService', 'class', 'Calculates the fee for every kind of ticket'));
    pricingConcrete.relationships = pricingConcrete.relationships.filter((r) => !['PricingStrategy', 'HourlyPricing', 'FlatPricing'].some((n) => r.from === n || r.to === n));
    pricingConcrete.relationships.push({ from: 'ParkingLot', to: 'PricingService', kind: 'association' });
    const r2 = await run(crcSubmission({ payload: pricingConcrete }));
    expect(ids(r2)).toContain('concrete-variation:pricing');
    expect(r2.findings.find((f) => f.id === 'concrete-variation:pricing')!.severity).toBe('major');
  });

  it('notes a single-variant abstraction without penalising it as dead', async () => {
    const payload = structuredClone(goodParkingLotPayload);
    payload.classes = payload.classes.filter((c) => c.name !== 'FlatPricing');
    payload.relationships = payload.relationships.filter((r) => r.from !== 'FlatPricing');
    const r = await run(crcSubmission({ payload }));
    expect(ids(r)).toContain('single-variant:pricing');
    expect(ids(r)).not.toContain('dead-abstraction:PricingStrategy');
  });

  it('grades change-scenario answers: brief, ungrounded, grounded', async () => {
    const r = await run(
      crcSubmission({
        answers: {
          S1: 'Add a class.',
          S2: 'I would introduce something new for weekend rates and adjust the configuration so that it works properly at the weekend.',
          S3: goodAnswers.S3,
        },
      }),
    );
    expect(ids(r)).toContain('scenario-brief:S1');
    expect(ids(r)).toContain('scenario-ungrounded:S2');
    expect(ids(r)).not.toContain('scenario-unanswered:S3');
    expect(ids(r)).not.toContain('scenarios-grounded');
  });

  it('recognises class names written as words in a scenario answer', async () => {
    const r = await run(crcSubmission({ answers: { S1: 'I would add a new pricing strategy for charging, and the parking lot itself would not change at all.', S2: goodAnswers.S2, S3: goodAnswers.S3 } }));
    expect(ids(r)).not.toContain('scenario-ungrounded:S1');
  });

  it('judges assumptions and trade-offs by content, not by length alone', async () => {
    const thin = await run(crcSubmission({ assumptions: 'We assume a single lot and fees are rounded up.', decisions: 'I used Strategy for pricing and a facade for the lot and kept spots as one class with a size field for simplicity of the model.' }));
    expect(ids(thin)).toContain('assumptions-thin');
    expect(ids(thin)).toContain('tradeoffs-no-reasons');
    const bulletList = await run(crcSubmission({ assumptions: '- One lot and one currency in use\n- Full lot refuses entry cleanly\n- No reservations are supported yet' }));
    expect(ids(bulletList)).toContain('assumptions-stated');
  });

  it('asks Mermaid users for responsibility notes rather than card fields', async () => {
    const s = mermaidSubmission(['classDiagram', '  class ParkingLot', '  class Level', '  class ParkingSpot', '  ParkingLot *-- Level', '  Level *-- ParkingSpot'].join('\n'));
    const r = await run(s);
    const f = r.findings.find((f) => f.ruleId === 'responsibilities-stated')!;
    expect(f.suggestion).toMatch(/note for ParkingLot/);
  });

  it('works against a different problem without changes to the rules', async () => {
    const payload = {
      classes: [
        card('VendingMachine', 'class', 'Coordinates purchases and owns the slots', ['insert(coin)', 'select(slot)', 'cancel()']),
        card('VendingState', 'interface', 'Defines what each action does in a machine state', ['insert()', 'select()', 'cancel()']),
        card('IdleState', 'class', 'Waits for money'),
        card('HasMoneyState', 'class', 'Waits for a selection'),
        card('Slot', 'class', 'Holds a product, its price and how many remain'),
        card('Product', 'class', 'Describes a sellable item'),
        card('CoinInventory', 'class', 'Tracks coin denominations held'),
        card('ChangeStrategy', 'interface', 'Works out change to return', ['makeChange(amount)']),
        card('GreedyChange', 'class', 'Returns the fewest coins'),
        card('BoundedChange', 'class', 'Returns change limited to coins held'),
      ],
      relationships: [
        { from: 'VendingMachine', to: 'VendingState', kind: 'association' },
        { from: 'IdleState', to: 'VendingState', kind: 'realization' },
        { from: 'HasMoneyState', to: 'VendingState', kind: 'realization' },
        { from: 'VendingMachine', to: 'Slot', kind: 'composition' },
        { from: 'Slot', to: 'Product', kind: 'association' },
        { from: 'VendingMachine', to: 'CoinInventory', kind: 'composition' },
        { from: 'VendingMachine', to: 'ChangeStrategy', kind: 'association' },
        { from: 'GreedyChange', to: 'ChangeStrategy', kind: 'realization' },
        { from: 'BoundedChange', to: 'ChangeStrategy', kind: 'realization' },
      ],
    };
    const r = await run(crcSubmission({ payload, answers: { S1: 'A CardPayment would be new; VendingMachine gains a payment reference.', S2: 'A Promotion applied by Slot at select time.', S3: 'A new OutOfServiceState implementing VendingState; VendingMachine switches to it.' } }), vendingMachine);
    expect(r.coverage!.find((c) => c.id === 'state')!.status).toBe('covered');
    expect(ids(r)).toContain('variability-handled');
  });
});
