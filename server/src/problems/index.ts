import { InMemoryProblemCatalog, type ProblemCatalog } from '../domain/problem/Problem';
import { elevator } from './elevator';
import { parkingLot } from './parkingLot';
import { rateLimiter } from './rateLimiter';
import { vendingMachine } from './vendingMachine';

/** To add a problem: define it like the ones next to this file and list it here. */
export function defaultCatalog(): ProblemCatalog {
  return new InMemoryProblemCatalog([parkingLot, vendingMachine, rateLimiter, elevator]);
}
