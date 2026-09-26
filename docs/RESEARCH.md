# Research note

*Written 26 Sep 2026. Sources were read on that date; anything behind a login is marked as not inspected.*

## The learner's problem

LLD practice is easy to **start** (there are endless "design a parking lot" write-ups) and hard to **evaluate**. A learner can produce a class diagram, feel fine about it, and still not know whether:

- each class has one clear job,
- the abstractions sit where the variation is,
- the design would survive the interviewer's favourite follow-up ("now add EV spots"),
- or whether a different design of theirs would have been just as good.

There is rarely one correct answer, so "compare with the solution" is weak feedback. And practice only works as a *loop*: the value is in the second attempt, which needs the first attempt's feedback to be specific enough to act on and remembered long enough to compare.

## What exists today

| Approach | Examples | What it does well | Where it stops |
|---|---|---|---|
| **Worked-solution courses** | [Educative's OOD course](https://www.educative.io/courses/grokking-the-object-oriented-design-interview), [Design Gurus](https://www.designgurus.io/course/grokking-the-object-oriented-design-interview), [AlgoMaster LLD](https://algomaster.io/learn/lld) | Clear requirements, a reference class diagram and code for classic problems | Passive. You read one solution; nothing looks at *yours*. Educative also sells mock interviews, which I did not inspect. |
| **Guided practice with AI feedback** | [Hello Interview LLD practice](https://www.hellointerview.com/practice/low-level-design) and its [delivery framework](https://www.hellointerview.com/learn/low-level-design/in-a-hurry/delivery) | A step-by-step flow (requirements → entities → class design → implementation → extensibility) with feedback per step | The practice tool is desktop-only and behind sign-in, so I could read only its problem list (Parking Lot, Elevator, Rate Limiter…) and the public framework. I could not verify how feedback is grounded or whether attempts are compared. |
| **AI feedback for system design** | [Codemia](https://codemia.io/) | A "choose, design, explain trade-offs, get feedback, revise" loop | Aimed at high-level design, not class-level. Reviewers' write-ups describe feedback as quick, not as verifiable. |
| **General chat assistants** | Any LLM | Flexible, conversational | Unstructured and inconsistent between runs; may praise or invent problems; nothing persists to show progress. |
| **Code-smell tooling** | Static analysers | Objective structure checks (god classes, cycles) | Work on code, not on a design sketch. Threshold-based detectors are known to be hard to tune, and thresholds calibrated for one language do not always transfer ([example](https://jitecs.ub.ac.id/index.php/jitecs/article/view/892)). |
| **Research on grading class diagrams** | [Automated grading of class diagrams](https://ieeexplore.ieee.org/document/8904595/), [Bouali et al., CSEDU 2025](https://research.utwente.nl/en/publications/toward-automated-uml-diagram-assessment-comparing-llm-generated-s/) | Automated grading by **matching against a reference solution** (syntactic, semantic and structural matching), and, more recently, **LLM grading**: on 92 student submissions, GPT o1-mini and Claude Sonnet reached correlations above 0.76 with three teaching assistants, with MAE under 4 on a 40-point scale | Reference matching penalises valid alternative designs. The LLM study succeeded partly because case studies were *constrained* to guide design choices and diagrams were converted to text first. |

Two further things I took from the literature and the craft:

- **CRC cards** ([Beck & Cunningham, 1989](http://www.cs.unc.edu/~stotts/COMP145/CRC/papers/beck.html)) make the *responsibility* of each class explicit, along with its collaborators. It is the decision a bare box on a diagram lets you skip.
- Automated feedback can be **gamed by trial and error** when learners iterate against a score rather than think ([systematic review of automated grading tools](https://dl.acm.org/doi/10.1145/3636515)). That argues for showing reasons over verdicts, and for holding back reference solutions until a learner has tried.

## Key gaps

1. **No feedback you can check.** Tools say "your class is doing too much" without pointing at the class, the requirement, or the reason.
2. **Reference-solution grading vs many valid answers.** Matching one canonical design punishes a good, different design.
3. **Iteration is not a first-class thing.** Attempts are rarely compared; a learner cannot see "I fixed the god class, but introduced a cycle".
4. **Extensibility is only tested in an interviewer's head.** "What changes when X arrives?" is the best test of a design, and no tool asks the learner to answer it against their own classes.
5. **AI feedback is all-or-nothing.** If the model is slow or down, there is no useful fallback, and there are no guardrails when it is wrong.

## Product direction

A **practice loop that treats a design as a claim to be tested**:

- **Submit the decision, not just the diagram.** An attempt has four parts: assumptions, the design (class cards with a one-sentence responsibility each, or Mermaid), answers to "what changes if…?", and the trade-offs. (Answers to the brief's first question in [DESIGN.md](DESIGN.md).)
- **Judge principles, not a reference design.** Feedback comes from a rubric (requirement ownership, cohesion, abstractions, extensibility, communication). Required concepts are matched by *vocabulary*, so several names for one idea all count.
- **Deterministic where it can be, AI where it must be.** Structural checks are instant and reproducible; the AI adds judgement, but every claim is checked against the learner's design, and it cannot be more generous than the evidence.
- **Make every finding checkable and actionable**: what, why it matters, what to try, which class it is about, and how confident the platform is.
- **Make improvement visible**: attempt history, a trend, and a comparison of fixed / still open / new problems.
- **Degrade gracefully**: instant structural feedback; AI slow or down means partial feedback and a retry, not an error page.
- **Reveal solutions after the attempt**, as a set of valid approaches with trade-offs, not "the answer".

## What I could not establish

I could not see inside the paid products, so the comparison above is from their public pages, problem lists and third-party reviews. I did not measure how well rule-based or AI feedback agrees with human reviewers on real learner designs, and that would be the first evaluation to run with real users.
