# AI usage

> **How to read this.** This project was built in a single session with **Claude Code** (Anthropic's coding agent), which did the research, design, code, tests and docs, at my direction. Each entry below records a meaningful AI-assisted decision *as it happened in that session*. **"My call"** states my position: I set the goal and directed the work, I did not write or review this code line by line, and for each decision I say whether I accept it and why. This file was drafted by Claude Code at my request and I am submitting it as my own account.

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

**My call:** I asked for the whole assignment to be built and accepted this evaluation design. The brief itself says an LLD problem can have more than one valid solution, which rules out grading against a single reference answer, and it asks which parts should be deterministic and which use an LLM. Rules first, with a bounded AI review on top, answers both. I accept the trade-off that the AI part is not reproducible; that is why it is limited, checked and never the only source of a score.

## 2. A documented SDK helper was wrong for this project; I replaced it

**The AI suggested.** The Claude API reference recommends `zodOutputFormat(schema)` for structured output, and the first draft used it.

**Accepted / rejected.** *Rejected after probing.* With this project's zod version the helper emitted enums as `"description": "{enum: [...]}"` instead of a real JSON-Schema `enum`, so the constraint that keeps a model's `dimension` and `severity` valid would silently disappear. I generate the schema with `z.toJSONSchema`, close every object and require every property in a small post-processor, and keep the wire schema to constructs structured outputs support (a test asserts no unsupported keywords appear). I kept a second validation layer regardless, since a generation-time constraint is not a reason to trust the output.

**Why.** Following documentation without running it would have shipped a schema that looked right and enforced less than it appeared to.

**Evidence.** `evaluation/ai/reviewSchema.ts` and the "review JSON schema" test.

**My call:** I did not find this myself; Claude Code caught it by testing the helper's output instead of trusting the documentation, and I accept the replacement. What I take from it: a documented shortcut is not a guarantee, so the schema now has a test that fails if the constraint is lost.

## 3. AI-written tests caught a real bug in AI-written code, and I kept the test's verdict

**What happened.** The state machine lets `EVALUATING → SUBMITTED` (needed for crash recovery), and `requestRetry` reused that transition. A test I wrote to assert "a learner cannot retry a finished or in-flight attempt" failed: a learner could have re-queued an attempt a worker was still evaluating, causing a double evaluation.

**Accepted / rejected.** *Fixed the domain*, adding an explicit guard in `Attempt.requestRetry` and a named regression test, rather than weakening the test. A second case: a "strong design" fixture exposed that my requirement-coverage rule flagged reasonable designs for not having a class for small concerns (like reporting a count); the rule was noisy, so I added an opt-in `implicitOk` on those capabilities instead of editing the fixture.

**Why.** The point of an adversarial test is that it disagrees with the author. Both bugs were the AI's own.

**Evidence.** `attempt.test.ts` ("regression: a learner cannot re-queue…"); `Capability.implicitOk`.

**My call:** I did not write the tests or the fix. I accept both, and I rely on the automated suite (205 tests) rather than my own line-by-line review. The lesson I would state in an interview: AI-written code needs tests written to disagree with it, and when one fails the code gets fixed, not the test.

## 4. Using the product found problems the tests could not

**What happened.** In the real UI, a design scored by structural rules alone received a perfect **4.0 "Strong"**. Rules can confirm a design is well formed but not that it is *good*, so the top band was overstated. Separately, I twice saw the review page stuck on "Queued" and first put it down to timing; the network log showed no polling requests at all. The cause was the browser pane reporting itself hidden, so the data library paused polling.

**Accepted / rejected.** *Added* a cap: structural-only scores cannot exceed 3.4, and the UI explains why. *Rejected* my first diagnosis (timing) once the evidence contradicted it, and instead made attempt polling continue in background tabs and put progress in the tab title, which is better product behaviour anyway (learners switch tabs during a slow review).

**Why.** Honest scoring matters more than a flattering number, and a wrong explanation of a bug is worse than none.

**Evidence.** `ScoreAggregator.structuralOnlyMax` and its tests; `useAttempt` (`refetchIntervalInBackground`).

**My call:** I accept both changes. I would rather the platform say "Solid" and explain why than show a flattering "Strong" that only rule checks produced, and a learner who switches tabs during a slow review should come back to a finished page. I also accept that the first guess about the stuck page was wrong and was corrected by evidence.

## 5. Where I would not let the AI vouch for itself

**The gap.** No API key was available, so **the live Claude path has never run**. It would have been easy to write plausible-looking output and call it a demo.

**Accepted / rejected.** *Rejected* faking AI results. Instead: the request body is type-checked against the SDK's own types; the prompt builder, schema, response validation and error classification are tested against a stubbed API; and a **clearly labelled demo reviewer** (`LLD_AI_PROVIDER=demo`) that says it is a stand-in in every sentence, and can be made slow, failing, flaky or malformed on demand so the degradation paths are demonstrable. The README states the gap plainly under Limitations.

**Why.** Feedback a learner acts on must not pretend to be more than it is, and neither should the project's own claims.

**Evidence.** `DemoDesignReviewer`, `AnthropicDesignReviewer` tests, README "Limitations".

**My call:** I did not provide an API key during the build, so I accept that the live Claude call is untested and I state that openly in the README rather than hide it. Running it once with a real key is still outstanding. I accept the clearly labelled demo reviewer as the honest way to show the whole flow without one.

---

## My own changes to the platform

After the build, I asked for a short list of small changes I could make myself, and picked three. Each was implemented by Claude Code; the choices and reasons are mine.

- **Weight extensibility more (chosen).** I raised Extensibility from 20% to 25% of the overall score and lowered Requirements coverage from 25% to 20%. My reason: how a design copes with change is the real test of low-level design, so it should count at least as much as owning the requirements. The weights are now pinned by a test and written up in `docs/DESIGN.md`.
- **Raise the no-AI score cap to 3.5 (chosen, then corrected).** I asked for this to make the platform a little less conservative when no AI review has run. The list I was given described 3.5 as the "top of Solid", which was **Claude's mistake**: in this scoring 3.5 is the *Strong* band, so it would have let an unreviewed design read as Strong. I accepted the correction, so the cap stays at 3.4 (the highest score that is still "Solid"), with a comment saying why and a guard test that fails if anyone raises it into the Strong band.
- **A hint-usage note (chosen).** When a learner opens the hints while working on an attempt, the review page adds a short note asking them to notice which points they would have found alone, since those are what to practise next. It is a small UI-only feature, stored per attempt in the browser, and I checked it in the running app.

## What still needs a human

- **Calibrate the rules against real learner designs.** They have only been tested on hand-written strong and weak fixtures.
- **Compare AI feedback with a human reviewer** on a small set of designs, as the research suggests, before trusting the scores.
- **Run it once with a real API key** and read the reviews.
- **Review the four problems' vocabularies** for fairness. They were written by the AI.
