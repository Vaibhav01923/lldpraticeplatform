# LLD Practice Platform

Practice **low-level design (LLD)** the way you would practise anything else: attempt it, get feedback you can check, revise, and see whether you actually improved.

```
Choose a problem → Design → Submit → Get feedback → Review → Try again
```

A learner picks a problem (Parking Lot, Vending Machine, Rate Limiter, Elevator), designs it as class cards or Mermaid, answers "what if the requirements change?" questions, and explains their trade-offs. They get scored, evidence-backed feedback in seconds, then revise, and the platform shows which problems they fixed.

| Deliverable | Where |
|---|---|
| Research note | [docs/RESEARCH.md](docs/RESEARCH.md) |
| Design note (MVP, classes, evaluation, trade-offs) | [docs/DESIGN.md](docs/DESIGN.md) |
| AI usage | [AI_USAGE.md](AI_USAGE.md) |
| Working prototype | this repo |
| Tests | `server/tests`, `web/src/**/*.test.ts` (`npm test`) |

---

## Run it

Requires **Node ≥ 22.13** (uses the built-in `node:sqlite`, so there is no native module to compile).

```bash
npm install
npm run build          # builds the web client into web/dist
npm start              # http://localhost:3000
```

That is enough to use everything except the AI review. To turn the AI review on, pick one:

```bash
# Real review from Claude
ANTHROPIC_API_KEY=sk-ant-... npm start

# No key? A built-in stand-in reviewer, clearly labelled as a demo, so you can see the whole flow
LLD_AI_PROVIDER=demo npm start
```

For development with hot reload (API on :3000, client on :5173):

```bash
npm run dev
```

### Try the failure paths

The brief asks what happens when evaluation is slow or fails. The demo reviewer can misbehave on purpose:

```bash
LLD_AI_PROVIDER=demo LLD_DEMO_MODE=fail  npm start   # AI always fails → "Part of the review did not finish" + Retry
LLD_AI_PROVIDER=demo LLD_DEMO_MODE=slow LLD_AI_TIMEOUT_MS=9000 npm start
                                                     # structural feedback appears at once, AI times out after 9s
LLD_AI_PROVIDER=demo LLD_DEMO_MODE=flaky npm start   # fails every other call → retries succeed
LLD_AI_PROVIDER=demo LLD_DEMO_MODE=garbage npm start # malformed model output → rejected by validation
```

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `data/lld.db` | SQLite file (`:memory:` for throwaway) |
| `ANTHROPIC_API_KEY` | – | Enables the Claude review |
| `LLD_AI_PROVIDER` | `auto` | `auto` (Claude if a key exists, else off) · `anthropic` · `demo` · `off` |
| `LLD_AI_MODEL` | `claude-opus-5` | Model used for reviews |
| `LLD_AI_TIMEOUT_MS` | `120000` | Time budget for one AI try |
| `LLD_AI_MAX_ATTEMPTS` | `2` | Tries per evaluation (transient failures and timeouts only) |
| `LLD_DEMO_MODE` | `ok` | `ok` `slow` `fail` `flaky` `garbage` (demo provider only) |
| `LLD_WORKER_CONCURRENCY` | `2` | Evaluations run at once |

Invalid or contradictory settings fail at start-up with a clear message.

---

## What is in the MVP

- **4 problems** with requirements, constraints, hints, and change scenarios. Adding one is a data file ([`server/src/problems`](server/src/problems)).
- **Two ways to submit a design**, both parsed into one canonical `DesignModel`:
  - *Class cards* (CRC): name, kind, a one-sentence **responsibility**, attributes, methods, plus relationships.
  - *Mermaid class diagram* with `note for X "responsibility"`.
  - Switching between them **converts** your work.
- **Live preflight**: as you type, the server parses your design and reports errors, warnings and a summary, and the client draws the diagram.
- **Autosave** with stale-write protection (a draft changed in another tab is not silently overwritten).
- **Evaluation** in two stages: 14 deterministic rules (instant, reproducible), then an optional AI review. Output is a 0–4 score on five dimensions, "do these next", and findings that each cite the class, requirement or scenario they are about.
- **Graceful degradation**: provisional feedback first, then per-evaluator timeout and retry, partial results, manual retry, and crash recovery.
- **History and progress**: trend chart, and a comparison that says which structural problems were **fixed / still open / new** between attempts.
- **Common approaches** (known-valid alternatives with trade-offs), unlocked only after your first submission.

## How feedback works (short version)

| | Deterministic rules | AI review |
|---|---|---|
| Good at | Structure: ownership, dead abstractions, god classes, dependency cycles, missing change answers | Judgement: is this responsibility cohesive? do your answers hold against your classes? are the trade-offs sound? |
| Reproducible | Yes | No |
| Available offline / instantly | Yes | No |
| Can be wrong | Yes (heuristics carry a confidence, and the AI can dispute them) | Yes (its claims are checked against your design before you see them) |

The two are blended with guardrails: the AI cannot be much more generous than the structural checks, structural checks alone cannot award the top band, and any class the AI mentions must actually exist in your design or the finding is demoted. Details in [docs/DESIGN.md](docs/DESIGN.md).

## Project layout

```
shared/contracts.ts        API/DTO types shared by server and client
server/src
  domain/                  Attempt (state machine), DesignModel, Problem, Rubric, errors, ports
  formats/                 SubmissionFormat + CRC cards + Mermaid parsers
  evaluation/              Evaluator, EvaluationPipeline, ScoreAggregator, FeedbackPrioritizer, ReportAssembler
    rules/                 the deterministic rules
    ai/                    reviewer port, Anthropic + demo adapters, prompt, sanitiser
  application/             PracticeService, EvaluationWorker, JobQueue, attempt comparison
  infrastructure/          AttemptRepository + SQLite and in-memory adapters
  http/                    Express app (thin adapter)
  problems/                the catalogue
  compositionRoot.ts       the one place concrete classes are chosen
web/src                    React client (pages, editors, review components)
```

## Tests

```bash
npm test            # everything
npm run typecheck
```

The suite covers the domain (state machine, model invariants), both submission formats, every rule against strong and weak designs, the aggregation guardrails, the pipeline under failure (timeouts, retries, hung evaluators, permanent errors, deterministic-stage failures), the AI safety layer (hallucinated evidence, malformed output, prompt-injection structure), one **repository contract suite run against both implementations**, the queue, worker and restart recovery, and end-to-end HTTP flows including the degraded paths and cross-learner access.

## Decisions worth knowing

- **Monolith, in-process queue, SQLite.** Deliberately. The seams (`AttemptRepository`, `JobQueue`, `DesignReviewer`, `SubmissionFormat`, `Evaluator`) are where a real deployment would swap in Postgres, a broker, another model or another input.
- **Feedback must be checkable.** Every finding names its evidence; AI findings that cite classes you do not have are dropped or demoted.
- **Scores are coarse on purpose** (0–4 bands, each built from named criteria you can expand). The findings matter more than the number.
- **Solutions come after attempts.** Common approaches unlock on first submission.

## Limitations (please read)

- **The live Claude path was not exercised against the real API**, because no API key was available while building. What *is* verified: the request body type-checks against the SDK's own types; the prompt, the JSON schema, response validation, error classification, and the sanitiser are unit-tested against a stubbed API; and the whole pipeline is tested with the demo reviewer. The first run with a real key is the first real end-to-end check. The default model (`claude-opus-5`) and the `output_config.format` structured-output parameter follow the SDK documentation and have not been called.
- **Rule quality is heuristic.** Capability coverage matches vocabulary, not meaning, so unusual naming can produce a false "missing"; thresholds like "god class" are judgement calls. Each rule finding carries a confidence, and the AI can dispute one, but the rules have not been calibrated against a labelled set of real learner designs.
- **Only four problems**, and their capability vocabularies were written by hand.
- **No authentication.** A random id in the browser scopes your attempts; clearing site data starts a fresh history.
- **No code submissions.** The `SubmissionFormat` seam is where a code-skeleton parser would go, but none is built.
- **No rate limiting** beyond a per-attempt cap (5 evaluation runs) on AI spend.
- **Single process.** The queue and worker share the API process; see the design note for how it would scale.
