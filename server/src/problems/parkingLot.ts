import { Problem } from '../domain/problem/Problem';

export const parkingLot = new Problem({
  id: 'parking-lot',
  title: 'Parking Lot',
  difficulty: 'medium',
  tagline: 'Assign spots, issue tickets, charge fees — and keep pricing and spot choice easy to change.',
  tags: ['Strategy', 'Facade', 'Entities & ownership'],
  estimatedMinutes: 45,
  context:
    'A multi-level car park wants software to run its gates. Drivers of different vehicles enter, are directed to a spot that fits, and pay when they leave. Management regularly tweaks how spots are chosen and how much things cost.',
  requirements: [
    { id: 'R1', text: 'The lot has several levels. Each level has spots of different sizes: motorcycle, compact and large.' },
    { id: 'R2', text: 'A vehicle (motorcycle, car or truck) arrives at an entry gate. The system finds a suitable free spot and issues a ticket recording the spot and the entry time.' },
    { id: 'R3', text: 'A vehicle only fits certain spots: a motorcycle fits any spot, a car fits compact or large, a truck fits only large.' },
    { id: 'R4', text: 'At an exit gate the driver presents the ticket. The system computes the fee from vehicle type and time parked, accepts payment (cash or card) and frees the spot.' },
    { id: 'R5', text: 'The lot can report the number of free spots per spot size, and refuses entry when no suitable spot is free.' },
    { id: 'R6', text: 'Several gates operate at the same time. Two vehicles must never be given the same spot.' },
  ],
  constraints: [
    'Model the core domain. You do not need to design hardware, a UI or a database.',
    'Assume one lot and one currency.',
    'Say, in a sentence or two, how you would stop two gates taking the last spot at once.',
  ],
  outOfScope: ['Reservations and pre-booking', 'Barrier, sensor and camera hardware', 'User interface and persistence'],
  capabilities: [
    { id: 'vehicle', label: 'Vehicles of different types', requirementIds: ['R2', 'R3'], keywords: ['vehicle', 'car', 'truck', 'motorcycle', 'bike'], hint: 'Something has to represent what is being parked and how big it is.' },
    { id: 'spot', label: 'Parking spots with a size', requirementIds: ['R1', 'R3'], keywords: ['spot', 'slot', 'space', 'bay'], hint: 'Something has to represent a place a vehicle can occupy, and which vehicles fit it.' },
    { id: 'level', label: 'Levels / floors', requirementIds: ['R1'], keywords: ['level', 'floor', 'deck', 'zone'], weight: 0.5, hint: 'Spots are grouped into levels; decide who owns that grouping.' },
    { id: 'ticket', label: 'Ticket linking entry to exit', requirementIds: ['R2', 'R4'], keywords: ['ticket', 'receipt', 'pass', 'token'], hint: 'Something must remember which spot a vehicle took and when it arrived, so exit can be handled later.' },
    { id: 'assignment', label: 'Choosing a free spot for a vehicle', requirementIds: ['R2', 'R3', 'R6'], keywords: ['allocat', 'assign', 'selector', 'finder', 'locator', 'placement', 'spot strategy', 'parking strategy', 'nearest'], hint: 'Someone has to decide which free, fitting spot a vehicle gets, and stop two gates choosing the same one.' },
    { id: 'pricing', label: 'Computing the parking fee', requirementIds: ['R4'], keywords: ['fee', 'price', 'pricing', 'tariff', 'rate', 'charge', 'fare', 'billing', 'cost'], hint: 'Fees depend on vehicle type and duration; decide where that calculation lives.' },
    { id: 'payment', label: 'Taking payment', requirementIds: ['R4'], keywords: ['payment', 'pay', 'cashier', 'transaction', 'checkout'], hint: 'Cash and card are handled at exit; decide who is responsible for taking payment.' },
    { id: 'gate', label: 'Entry and exit gates', requirementIds: ['R2', 'R4', 'R6'], keywords: ['gate', 'entrance', 'entry', 'exit', 'kiosk', 'barrier', 'terminal'], weight: 0.5, implicitOk: true, hint: 'Gates are where work enters the system, and where concurrency happens.' },
    { id: 'availability', label: 'Reporting free spots', requirementIds: ['R5'], keywords: ['availability', 'display', 'board', 'capacity', 'inventory', 'count'], weight: 0.5, implicitOk: true, hint: 'Someone must answer "how many free spots per size?"' },
  ],
  variabilityPoints: [
    { id: 'pricing', label: 'Fee calculation', why: 'Rates differ by vehicle type and duration, and pricing rules change often (weekends, peak hours, loyalty).', keywords: ['fee', 'price', 'pricing', 'tariff', 'rate', 'charge', 'billing'], accepts: 'abstraction' },
    { id: 'assignment', label: 'Spot selection policy', why: 'Which free spot to pick (nearest the entrance, lowest level, closest to the exit) is a policy operators will want to change.', keywords: ['allocat', 'assign', 'selector', 'finder', 'locator', 'placement', 'spot strategy', 'parking strategy'], accepts: 'abstraction' },
    { id: 'payment', label: 'Payment method', why: 'Cash and card behave differently, and new methods (wallets, passes) keep appearing.', keywords: ['payment', 'pay', 'cashier'], accepts: 'abstraction' },
    { id: 'vehicle', label: 'Vehicle types', why: 'Vehicle kinds differ in size class, and new kinds (bus, EV) appear.', keywords: ['vehicle'], accepts: 'abstraction-or-enum' },
  ],
  scenarios: [
    { id: 'S1', prompt: 'The operator adds EV charging spots reserved for electric vehicles, with an extra per-kWh charge added at exit. Which existing classes would you have to change, and which would you add?', likelyConcepts: ['spot', 'vehicle', 'pricing'] },
    { id: 'S2', prompt: 'Management introduces weekend and peak-hour pricing. What has to change in your design?', likelyConcepts: ['pricing', 'ticket'] },
    { id: 'S3', prompt: 'Monthly-pass holders park free in reserved spots. Walk through what changes when one arrives and leaves.', likelyConcepts: ['ticket', 'spot', 'payment'] },
  ],
  hints: [
    'List the nouns in the requirements, then decide which deserve to be classes (they hold changing state or enforce rules) and which are just fields.',
    'For each behaviour — "does this vehicle fit?", "how much is owed?", "which spot?" — ask who knows enough to do it without reaching into someone else\'s data.',
    'Look for what will change. What would you hate to edit every time management changes a rule?',
  ],
  approaches: [
    {
      title: 'Facade with pluggable strategies',
      summary: 'A ParkingLot facade owns the levels and coordinates entry and exit. Spot selection and fee calculation sit behind small interfaces, so each policy can be swapped without touching the lot.',
      whenItFits: 'Operators want to tune how spots are chosen or how fees are computed without redeploying the core.',
      tradeoffs: ['More types to read for a small problem.', 'Strategies should be stateless, or they become a hidden place for bugs.'],
      patterns: ['Facade', 'Strategy'],
    },
    {
      title: 'Spot size as data versus spot subclasses',
      summary: 'One ParkingSpot class with a SpotSize enum and a fits(vehicle) rule, or CompactSpot/LargeSpot subclasses. Both are valid.',
      whenItFits: 'The enum is simpler while spots differ only in size. Subclasses earn their keep when spot kinds behave differently, such as an EV spot running a charging session.',
      tradeoffs: ['Enum: fewer classes, but a new behaviour means editing shared code.', 'Subclasses: extensible, but easy to over-model.'],
      patterns: ['Polymorphism', 'Enum-as-type'],
    },
    {
      title: 'The ticket carries a pricing snapshot',
      summary: 'The ticket records entry time and the pricing policy in force when it was issued, so a later rate change does not surprise drivers who are already parked.',
      whenItFits: 'Fairness to in-flight customers matters more than the simplicity of one global rate.',
      tradeoffs: ['Extra state on the ticket and a versioning question for policies.'],
      patterns: ['Strategy', 'Value object'],
    },
  ],
});
