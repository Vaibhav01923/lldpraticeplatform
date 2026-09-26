import { Problem } from '../domain/problem/Problem';

export const elevator = new Problem({
  id: 'elevator',
  title: 'Elevator System',
  difficulty: 'hard',
  tagline: 'Several elevators, hall and cabin calls, and a dispatch policy that is not set in stone.',
  tags: ['State', 'Strategy', 'Scheduling'],
  estimatedMinutes: 60,
  context:
    'An office tower has several elevators serving many floors. People call an elevator from a floor and choose a destination once inside. A dispatcher decides which elevator takes which call.',
  requirements: [
    { id: 'R1', text: 'A building has N floors and M elevators; both are configurable.' },
    { id: 'R2', text: 'A person on a floor presses Up or Down (a hall call). Inside an elevator, a person presses a destination floor (a cabin call).' },
    { id: 'R3', text: 'A dispatcher decides which elevator serves each hall call, aiming to keep waiting times low.' },
    { id: 'R4', text: 'Each elevator moves one floor at a time, stops at requested floors, opens and closes its doors, and knows its direction (up, down or idle).' },
    { id: 'R5', text: 'An elevator serves the requests in its current direction before reversing, and never exceeds its weight capacity.' },
    { id: 'R6', text: 'An elevator can be taken out of service (maintenance or emergency). Calls must then go to the others.' },
  ],
  constraints: [
    'Focus on the objects and their responsibilities, not on a full simulation loop.',
    'Be explicit about who owns the pending stops of an elevator.',
  ],
  outOfScope: ['Physical motor and sensor control', 'Passenger-flow prediction', 'A user interface'],
  capabilities: [
    { id: 'elevator', label: 'Elevators', requirementIds: ['R1', 'R4', 'R5'], keywords: ['elevator', 'car', 'cabin', 'lift'], hint: 'Something has to represent a single elevator, its position and what it will do next.' },
    { id: 'floor', label: 'Floors', requirementIds: ['R1', 'R2'], keywords: ['floor', 'level', 'storey'], weight: 0.5, hint: 'Decide whether a floor is worth modelling or is just a number.' },
    { id: 'request', label: 'Hall and cabin calls', requirementIds: ['R2'], keywords: ['request', 'call', 'button', 'panel'], hint: 'Something has to capture what a person asked for, and whether it came from the hall or the cabin.' },
    { id: 'dispatch', label: 'Dispatching calls to elevators', requirementIds: ['R3'], keywords: ['dispatch', 'schedul', 'controller', 'coordinator', 'assign', 'allocat', 'selector'], hint: 'Someone decides which elevator serves a hall call.' },
    { id: 'direction', label: 'Direction of travel', requirementIds: ['R4', 'R5'], keywords: ['direction', 'movement'], weight: 0.5, implicitOk: true, hint: 'Up, down and idle matter to both movement and dispatch.' },
    { id: 'door', label: 'Doors', requirementIds: ['R4'], keywords: ['door'], weight: 0.5, implicitOk: true, hint: 'Doors open and close around each stop.' },
    { id: 'state', label: 'Elevator states', requirementIds: ['R4', 'R6'], keywords: ['state', 'status', 'mode'], hint: 'Moving, stopped, doors open and out of service behave differently. Something has to make that explicit.' },
    { id: 'capacity', label: 'Weight capacity', requirementIds: ['R5'], keywords: ['capacity', 'load', 'weight', 'overload'], weight: 0.5, implicitOk: true, hint: 'Overload has to be detected somewhere.' },
    { id: 'building', label: 'The building / system', requirementIds: ['R1'], keywords: ['building', 'system', 'bank'], weight: 0.5, hint: 'Something owns the elevators and floors as a whole.' },
  ],
  variabilityPoints: [
    { id: 'dispatch', label: 'Dispatch policy', why: 'Nearest-car, zoned and destination-dispatch algorithms trade waiting time against throughput, and buildings choose differently.', keywords: ['dispatch', 'schedul', 'assign', 'allocat', 'selector', 'strategy'], accepts: 'abstraction' },
    { id: 'state', label: 'Elevator state behaviour', why: 'What an elevator does on a new request depends on its state, and modes such as fire service or maintenance get added.', keywords: ['state', 'status', 'mode'], accepts: 'abstraction-or-enum' },
    { id: 'request', label: 'Kinds of request', why: 'Hall calls and cabin calls carry different information, and new kinds (priority, VIP) appear.', keywords: ['request', 'call'], accepts: 'abstraction-or-enum' },
  ],
  scenarios: [
    { id: 'S1', prompt: 'Add express elevators that stop only at floors 1, 20 and 40. What changes?', likelyConcepts: ['elevator', 'dispatch', 'request'] },
    { id: 'S2', prompt: 'Switch to destination dispatch: passengers enter their floor at a lobby keypad and are told which elevator to take. What changes and what stays?', likelyConcepts: ['dispatch', 'request'] },
    { id: 'S3', prompt: 'Add a fire mode: every car returns to the lobby, ignores new calls and opens its doors. Where does that live?', likelyConcepts: ['state', 'elevator'] },
  ],
  hints: [
    'Separate "what should this elevator do next?" (its own stops) from "which elevator should take this call?" (the whole building).',
    'The moving/stopped/doors-open/out-of-service behaviour is a good candidate for something that changes as the requirements grow.',
    'Decide who owns the queue of pending stops before you draw any arrows.',
  ],
  approaches: [
    {
      title: 'Controller + per-elevator state machine + dispatch strategy',
      summary: 'An ElevatorController owns the elevators and delegates to a DispatchStrategy to assign hall calls. Each Elevator runs its own state machine and stop queue.',
      whenItFits: 'You want to change the dispatch algorithm without touching elevator internals and reason about one elevator in isolation.',
      tradeoffs: ['More moving parts than a single class.', 'The interface between controller and elevators needs care.'],
      patterns: ['Strategy', 'State'],
    },
    {
      title: 'Event-driven (observer)',
      summary: 'Elevators publish position and state changes and the dispatcher subscribes, so assignment reacts to what is really happening.',
      whenItFits: 'Dispatch decisions depend on live conditions and you want components loosely coupled.',
      tradeoffs: ['Harder to trace and test than direct calls.', 'Needs ordering and race-condition discipline.'],
      patterns: ['Observer'],
    },
    {
      title: 'Who owns the stop queue?',
      summary: 'Each elevator keeps its own SCAN-style stop list, and the controller only assigns calls to elevators. The alternative, a central queue that tells elevators where to go, is simpler to reason about but couples them.',
      whenItFits: 'Per-elevator ownership fits when cars are independent; central ownership fits tight coordination such as destination dispatch.',
      tradeoffs: ['Local queues: encapsulated but harder to optimise globally.', 'Central queue: easy to optimise, a single point of complexity.'],
      patterns: ['Encapsulation'],
    },
  ],
});
