import { Problem } from '../domain/problem/Problem';

export const rateLimiter = new Problem({
  id: 'rate-limiter',
  title: 'Rate Limiter',
  difficulty: 'medium',
  tagline: 'Several limiting algorithms, configurable rules, and storage you can swap.',
  tags: ['Strategy', 'Ports & adapters', 'Concurrency'],
  estimatedMinutes: 40,
  context:
    'An API gateway wants to protect its endpoints from overuse. For each incoming request it must quickly decide whether the caller is still within their limits. Different customers and endpoints have different limits, and the team wants to try different algorithms.',
  requirements: [
    { id: 'R1', text: 'Provide an operation that decides whether a request from a client to a resource may proceed. It is called on every request, so it must be cheap.' },
    { id: 'R2', text: 'Support several algorithms (at least fixed window, sliding window and token bucket). Each rule picks one.' },
    { id: 'R3', text: 'Limits are configurable per client, per tier (free or pro) and per endpoint, and rules can change at runtime without a restart.' },
    { id: 'R4', text: 'A rejected request reports how long to wait before retrying. An allowed request reports the remaining quota.' },
    { id: 'R5', text: 'The limiter is correct under concurrent calls, and one client\'s traffic never affects another\'s counters.' },
    { id: 'R6', text: 'Counters live in a store that is in-memory today but must be replaceable later, for example by a shared cache.' },
  ],
  constraints: [
    'Design the objects and interfaces. You do not need to implement the algorithms.',
    'Say where you would put the code that must be atomic.',
  ],
  outOfScope: ['HTTP middleware wiring', 'Metrics and dashboards', 'A concrete distributed cache implementation'],
  capabilities: [
    { id: 'limiter', label: 'The limiter entry point', requirementIds: ['R1'], keywords: ['limiter', 'limit', 'throttl', 'gatekeeper', 'guard'], hint: 'Something has to expose the "may this request proceed?" decision.' },
    { id: 'algorithm', label: 'Limiting algorithms', requirementIds: ['R2'], keywords: ['algorithm', 'strategy', 'bucket', 'window', 'counter'], hint: 'Fixed window, sliding window and token bucket each need a home, and a way to be chosen per rule.' },
    { id: 'rule', label: 'Rules and configuration', requirementIds: ['R3'], keywords: ['rule', 'policy', 'config', 'plan', 'tier', 'quota'], hint: 'Something has to say which limit applies to which client and endpoint, and be changeable at runtime.' },
    { id: 'client', label: 'Client identity', requirementIds: ['R1', 'R3', 'R5'], keywords: ['client', 'user', 'key', 'identity', 'principal', 'caller'], weight: 0.5, implicitOk: true, hint: 'Counters are per caller; decide how a caller is identified.' },
    { id: 'store', label: 'Counter storage', requirementIds: ['R5', 'R6'], keywords: ['store', 'storage', 'repository', 'backend', 'cache'], hint: 'Something has to hold the counters behind an interface that can be swapped.' },
    { id: 'decision', label: 'Decision result', requirementIds: ['R4'], keywords: ['decision', 'result', 'outcome', 'response', 'verdict'], hint: 'The answer carries more than a yes or no: remaining quota and retry-after.' },
  ],
  variabilityPoints: [
    { id: 'algorithm', label: 'Limiting algorithm', why: 'Fixed window, sliding window and token bucket behave differently, and new ones (leaky bucket) will be requested.', keywords: ['algorithm', 'strategy', 'bucket', 'window'], accepts: 'abstraction' },
    { id: 'store', label: 'Counter storage', why: 'In-memory today; a shared cache later, without rewriting the algorithms.', keywords: ['store', 'storage', 'repository', 'backend', 'cache'], accepts: 'abstraction' },
  ],
  scenarios: [
    { id: 'S1', prompt: 'Add a leaky-bucket algorithm. Which classes change and which are added?', likelyConcepts: ['algorithm'] },
    { id: 'S2', prompt: 'Share limits across many servers using a distributed store such as Redis. What changes?', likelyConcepts: ['store', 'algorithm'] },
    { id: 'S3', prompt: 'Add a global per-endpoint limit that applies on top of each client\'s own limit. What changes?', likelyConcepts: ['rule', 'limiter'] },
  ],
  hints: [
    'Separate "which rule applies to this caller?" from "how does this algorithm count?" from "where are the counters kept?".',
    'What does an algorithm need to be given (a key, a rule, a clock, a store), and what should it return?',
    'Whatever must be atomic should live behind a small interface so it can be replaced later.',
  ],
  approaches: [
    {
      title: 'Strategy per algorithm + rule repository + counter store port',
      summary: 'A RateLimiter asks a RuleRepository for the rule, picks the algorithm named by the rule, and lets it read and update a CounterStore. Each algorithm implements one interface.',
      whenItFits: 'The default, clean answer when algorithms, rules and storage all vary independently.',
      tradeoffs: ['Three seams to name and test.', 'The store interface must allow an atomic update, or the design leaks races.'],
      patterns: ['Strategy', 'Repository', 'Ports & adapters'],
    },
    {
      title: 'Composite of limiters',
      summary: 'A per-client limiter and a global limiter each implement the same interface; a composite requires every one to allow the request.',
      whenItFits: 'You need several independent limits at once, such as per-client, per-endpoint and global.',
      tradeoffs: ['Partial consumption when the first passes and the second rejects needs a policy.', 'Slightly harder to explain the retry-after value.'],
      patterns: ['Composite', 'Chain of responsibility'],
    },
    {
      title: 'Decorators for cross-cutting concerns',
      summary: 'Logging and metrics wrap a RateLimiter behind the same interface rather than living inside it.',
      whenItFits: 'You want observability without touching the decision logic.',
      tradeoffs: ['Extra indirection for a small benefit if there is no observability requirement.'],
      patterns: ['Decorator'],
    },
  ],
});
