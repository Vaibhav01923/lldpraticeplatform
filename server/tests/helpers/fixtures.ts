import { Submission } from '../../src/domain/attempt/Submission';
import { Rubric } from '../../src/domain/evaluation/Rubric';
import type { Problem } from '../../src/domain/problem/Problem';
import type { EvaluationContext } from '../../src/evaluation/Evaluator';
import { CrcCardsFormat } from '../../src/formats/CrcCardsFormat';
import { MermaidClassDiagramFormat } from '../../src/formats/MermaidClassDiagramFormat';
import { parkingLot } from '../../src/problems/parkingLot';

type Card = { name: string; kind?: string; responsibility?: string; attributes?: string[]; methods?: string[] };
type Rel = { from: string; to: string; kind: string; label?: string };

export const card = (name: string, kind: string, responsibility: string, methods: string[] = [], attributes: string[] = []): Card => ({
  name,
  kind,
  responsibility,
  methods,
  attributes,
});

/** A design that a reviewer would call solid: strategies for varying parts, clear ownership, no smells. */
export const goodParkingLotPayload = {
  classes: [
    card('ParkingLot', 'class', 'Coordinates entry and exit and owns the levels', ['enter(vehicle)', 'exit(ticket)'], ['levels']),
    card('Level', 'class', 'Owns the spots on one floor and counts free ones per size', ['freeSpots(size)'], ['spots']),
    card('ParkingSpot', 'class', 'Knows its size and whether it is taken, and whether a vehicle fits', ['fits(vehicle)', 'reserve()', 'release()'], ['size', 'occupied']),
    card('Vehicle', 'abstract', 'Knows the size class a vehicle needs', ['requiredSize()']),
    card('Car', 'class', 'A car, which needs a compact or large spot'),
    card('Motorcycle', 'class', 'A motorcycle, which fits any spot'),
    card('Truck', 'class', 'A truck, which needs a large spot'),
    card('Ticket', 'class', 'Records which spot a vehicle took and when it entered', ['duration()'], ['spot', 'entryTime']),
    card('SpotAssignmentStrategy', 'interface', 'Chooses a free, fitting spot for a vehicle', ['choose(levels, vehicle)']),
    card('NearestSpotStrategy', 'class', 'Chooses the free spot closest to the entrance'),
    card('LowestLevelStrategy', 'class', 'Chooses the free spot on the lowest level'),
    card('PricingStrategy', 'interface', 'Computes the fee owed for a ticket', ['fee(ticket)']),
    card('HourlyPricing', 'class', 'Charges per started hour, by vehicle type'),
    card('FlatPricing', 'class', 'Charges a flat fee per visit'),
    card('PaymentMethod', 'interface', 'Takes payment of an amount', ['pay(amount)']),
    card('CashPayment', 'class', 'Takes cash payment'),
    card('CardPayment', 'class', 'Takes card payment'),
    card('ExitGate', 'class', 'Handles a driver leaving: reads the ticket and takes payment', ['process(ticket)']),
  ],
  relationships: [
    { from: 'ParkingLot', to: 'Level', kind: 'composition' },
    { from: 'Level', to: 'ParkingSpot', kind: 'composition' },
    { from: 'Car', to: 'Vehicle', kind: 'inheritance' },
    { from: 'Motorcycle', to: 'Vehicle', kind: 'inheritance' },
    { from: 'Truck', to: 'Vehicle', kind: 'inheritance' },
    { from: 'Ticket', to: 'ParkingSpot', kind: 'association' },
    { from: 'Ticket', to: 'Vehicle', kind: 'association' },
    { from: 'ParkingLot', to: 'SpotAssignmentStrategy', kind: 'association' },
    { from: 'NearestSpotStrategy', to: 'SpotAssignmentStrategy', kind: 'realization' },
    { from: 'LowestLevelStrategy', to: 'SpotAssignmentStrategy', kind: 'realization' },
    { from: 'ParkingLot', to: 'PricingStrategy', kind: 'association' },
    { from: 'HourlyPricing', to: 'PricingStrategy', kind: 'realization' },
    { from: 'FlatPricing', to: 'PricingStrategy', kind: 'realization' },
    { from: 'ExitGate', to: 'ParkingLot', kind: 'association' },
    { from: 'ExitGate', to: 'PaymentMethod', kind: 'association' },
    { from: 'CashPayment', to: 'PaymentMethod', kind: 'realization' },
    { from: 'CardPayment', to: 'PaymentMethod', kind: 'realization' },
    { from: 'ParkingLot', to: 'Ticket', kind: 'dependency' },
  ],
};

export const goodAssumptions = [
  'One lot, one currency, fees rounded up to the started hour.',
  'A spot is either free or taken; there are no reservations.',
  'If the lot is full the gate refuses entry and nothing is created.',
  'Two gates may race; spot reservation is atomic in ParkingSpot.reserve().',
].join('\n');

export const goodDecisions =
  'I used a Strategy for spot assignment and for pricing because both are policies management will change, instead of hard-coding them in ParkingLot. ' +
  'Spots are one class with a size rather than a subclass per size, since they only differ in data; the trade-off is that an EV spot with real behaviour would need subclasses later. ' +
  'ParkingLot is a facade that delegates, so it stays small.';

export const goodAnswers = {
  S1: 'I would add an EVSpot extending ParkingSpot and a ChargingPricing implementing PricingStrategy that adds the per-kWh charge. ParkingLot, Ticket and Level would not change; only NearestSpotStrategy needs to prefer EV spots for electric vehicles.',
  S2: 'I would add a PeakHourPricing class implementing PricingStrategy and select it in ParkingLot. No other class changes, because ExitGate only calls PricingStrategy.fee.',
  S3: 'A MonthlyPassPricing returns zero, and SpotAssignmentStrategy gets a reserved-spots rule. Ticket keeps working unchanged because it only stores the spot and entry time.',
};

export interface SubmissionInput {
  payload?: unknown;
  assumptions?: string;
  decisions?: string;
  answers?: Record<string, string>;
}

export function crcSubmission(input: SubmissionInput = {}): Submission {
  const format = new CrcCardsFormat();
  const payload = input.payload ?? goodParkingLotPayload;
  const { model, issues } = format.parse(payload);
  if (!model) throw new Error(`fixture invalid: ${issues.map((i) => i.message).join('; ')}`);
  return new Submission(format.id, payload, model, input.assumptions ?? goodAssumptions, input.decisions ?? goodDecisions, input.answers ?? goodAnswers, new Date('2026-01-01T00:00:00Z'));
}

export function mermaidSubmission(source: string, extra: Omit<SubmissionInput, 'payload'> = {}): Submission {
  const format = new MermaidClassDiagramFormat();
  const payload = { source };
  const { model, issues } = format.parse(payload);
  if (!model) throw new Error(`fixture invalid: ${issues.map((i) => i.message).join('; ')}`);
  return new Submission(format.id, payload, model, extra.assumptions ?? goodAssumptions, extra.decisions ?? goodDecisions, extra.answers ?? goodAnswers, new Date('2026-01-01T00:00:00Z'));
}

export function contextFor(submission: Submission, problem: Problem = parkingLot): EvaluationContext {
  return { problem, submission, rubric: Rubric.standard, priorFindings: [] };
}

/** A weak design: one overloaded "Manager", no abstractions, no answers, no reasoning. */
export const weakParkingLotPayload = {
  classes: [
    card('ParkingManager', 'class', 'Handles vehicles, finds spots, issues tickets, calculates fees and takes payments', ['parkVehicle()', 'removeVehicle()', 'findSpot()', 'issueTicket()', 'calculateFee()', 'takePayment()', 'checkFull()', 'countFree()', 'printReceipt()'], ['spots', 'tickets', 'vehicles']),
    card('Vehicle', 'class', 'A vehicle'),
    card('Spot', 'class', ''),
    card('Ticket', 'class', 'A ticket'),
    card('Helper', 'class', ''),
  ],
  relationships: [
    { from: 'ParkingManager', to: 'Vehicle', kind: 'association' },
    { from: 'ParkingManager', to: 'Spot', kind: 'association' },
    { from: 'ParkingManager', to: 'Ticket', kind: 'association' },
  ],
};
