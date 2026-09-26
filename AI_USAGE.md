# AI usage

> **Read this first.** This project was built in a single session with **Claude Code** (Anthropic's coding agent), which did the research, design, code, tests and docs. This file records the meaningful AI-assisted decisions *as they actually happened in that session*. The person submitting should read it, correct anything that does not match their own understanding, and add their own view under each entry ("My call"). It is not a substitute for their judgement, and I have not invented any.

## How AI was used, overall

- **Research**: web searches and reading public pages (see [docs/RESEARCH.md](docs/RESEARCH.md) for what could and could not be inspected).
- **Design and implementation**: the AI proposed the architecture and wrote the code; every layer has tests, and the running product was driven in a real browser.
- **Verification**: tests, type-checking, and using the app, including its failure modes. Several decisions below came from *that*, not from the initial plan.

---

## 1. Evaluation approach: hybrid, not a reference solution and not a bare LLM

**The AI suggested / surfaced.** Research turned up two published ways to grade class designs automatically: match against an instructor's **reference solution**, and **LLM grading** (a 2025 study reports correlations above 0.76 with teaching assistants on 92 submissions). The AI's initial plan was to blend deterministic rules with an LLM.

**Accepted / rejected.** *Rejected* reference matching, because LLD has many valid answers and it punishes them. *Accepted* the LLM, but *bounded*: it cannot be more than one band more generous than the structural score, structural checks cap the result, every class it cites is verified against the design, and the platform's own rules can be disputed by it.

**Why.** An unguarded LLM is non-reproducible, slow, can flatter, and can invent problems. Rules alone cannot judge cohesion or trade-offs. Neither alone is trustworthy enough to show a learner.

**Evidence.** `ScoreAggregator`, `ReviewSanitizer`, and their tests (`aggregation.test.ts`, `ai.test.ts`).

**My call:** _(submitter to add)_

## 2. A documented SDK helper was wrong for this project; I replaced it

**The AI suggested.** The Claude API reference recommends `zodOutputFormat(schema)` for structured output, and the first draft used it.

**Accepted / rejected.** *Rejected after probing.* With this project's zod version the helper emitted enums as `"description": "{enum: [...]}"` instead of a real JSON-Schema `enum`, so the constraint that keeps a model's `dimension` and `severity` valid would silently disappear. I generate the schema with `z.toJSONSchema`, close every object and require every property in a small post-processor, and keep the wire schema to constructs structured outputs support (a test asserts no unsupported keywords appear). I kept a second validation layer regardless, since a generation-time constraint is not a reason to trust the output.

**Why.** Following documentation without running it would have shipped a schema that looked right and enforced less than it appeared to.

**Evidence.** `evaluation/ai/reviewSchema.ts` and the "review JSON schema" test.

**My call:** _(submitter to add)_

## 3. AI-written tests caught a real bug in AI-written code, and I kept the test's verdict

**What happened.** The state machine lets `EVALUATING → SUBMITTED` (needed for crash recovery), and `requestRetry` reused that transition. A test I wrote to assert "a learner cannot retry a finished or in-flight attempt" failed: a learner could have re-queued an attempt a worker was still evaluating, causing a double evaluation.

**Accepted / rejected.** *Fixed the domain*, adding an explicit guard in `Attempt.requestRetry` and a named regression test, rather than weakening the test. A second case: a "strong design" fixture exposed that my requirement-coverage rule flagged reasonable designs for not having a class for small concerns (like reporting a count); the rule was noisy, so I added an opt-in `implicitOk` on those capabilities instead of editing the fixture.

**Why.** The point of an adversarial test is that it disagrees with the author. Both bugs were the AI's own.

**Evidence.** `attempt.test.ts` ("regression: a learner cannot re-queue…"); `Capability.implicitOk`.

**My call:** _(submitter to add)_

## 4. Using the product found problems the tests could not

**What happened.** In the real UI, a design scored by structural rules alone received a perfect **4.0 "Strong"**. Rules can confirm a design is well formed but not that it is *good*, so the top band was overstated. Separately, I twice saw the review page stuck on "Queued" and first put it down to timing; the network log showed no polling requests at all. The cause was the browser pane reporting itself hidden, so the data library paused polling.

**Accepted / rejected.** *Added* a cap: structural-only scores cannot exceed 3.4, and the UI explains why. *Rejected* my first diagnosis (timing) once the evidence contradicted it, and instead made attempt polling continue in background tabs and put progress in the tab title, which is better product behaviour anyway (learners switch tabs during a slow review).

**Why.** Honest scoring matters more than a flattering number, and a wrong explanation of a bug is worse than none.

**Evidence.** `ScoreAggregator.structuralOnlyMax` and its tests; `useAttempt` (`refetchIntervalInBackground`).

**My call:** _(submitter to add)_

## 5. Where I would not let the AI vouch for itself

**The gap.** No API key was available, so **the live Claude path has never run**. It would have been easy to write plausible-looking output and call it a demo.

**Accepted / rejected.** *Rejected* faking AI results. Instead: the request body is type-checked against the SDK's own types; the prompt builder, schema, response validation and error classification are tested against a stubbed API; and a **clearly labelled demo reviewer** (`LLD_AI_PROVIDER=demo`) that says it is a stand-in in every sentence, and can be made slow, failing, flaky or malformed on demand so the degradation paths are demonstrable. The README states the gap plainly under Limitations.

**Why.** Feedback a learner acts on must not pretend to be more than it is, and neither should the project's own claims.

**Evidence.** `DemoDesignReviewer`, `AnthropicDesignReviewer` tests, README "Limitations".

**My call:** _(submitter to add)_

---

## What still needs a human

- **Calibrate the rules against real learner designs.** They have only been tested on hand-written strong and weak fixtures.
- **Compare AI feedback with a human reviewer** on a small set of designs, as the research suggests, before trusting the scores.
- **Run it once with a real API key** and read the reviews.
- **Review the four problems' vocabularies** for fairness. They were written by the AI.
