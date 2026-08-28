# Host Adapter 0.1.12 RC9 — S1.8 User-Visible Task-Completion Closeout

## Baseline

- Stable baseline: Host Adapter 0.1.11.
- Candidate: Host Adapter 0.1.12-rc.9.
- Life candidate: 0.1.1-rc.2.
- Frozen dependencies: Core 0.3.0, Runtime 0.1.0, Profiles 0.2.0, APP/Observatory 0.5.0, Local Provider 0.1.0, Native Judge Transport 0.1.0.

## What real S1.8 proved

S1.8 passed structured Agent/Judge readiness, 56/56 delivery, 17 process segments, Research 14/14 exactly-once, durable restart/evidence gates, and Observatory. The original semantic evaluator reported zero findings. Manual review showed that this was insufficient: Tutor Turn 15 did not actually provide the requested next checkpoint, and Research Turn 1 hid the canonical hypothesis in structured `action.claim` instead of user-visible prose.

## RC9 changes

1. `TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE` — explicit next-practice/checkpoint requests require an actionable learner task/checkpoint.
2. `RESEARCH_CLAIM_NOT_VISIBLE` — `claim-proposal` must expose the exact Host-accepted claim text in the user-visible message.
3. Both failure classes use Host-owned repair and Host-owned-message Judge false-positive suppression.

## Regression evidence

- Host tests: 126/126 PASS.
- `npm run check`: PASS, including callback live gate.
- S1.9 semantic backstop on real S1.8 detects the two Host findings plus seven separate Life service-completion findings.

## Promotion gate

RC9 is **not Stable**. One clean real S1.9 must pass readiness, 56/56 delivery, 14/14 exactly-once, strengthened semantic findings=0, Observatory, and manual user-visible review before Host 0.1.12 can be promoted.

---

# Host Adapter 0.1.12 RC8 — S1.7 Research Mutation-Safety Closeout

## Baseline

- Stable baseline: Host Adapter 0.1.11.
- Candidate: Host Adapter 0.1.12-rc.8.
- Life candidate remains 0.1.1-rc.1.
- Frozen dependencies: Core 0.3.0, Runtime 0.1.0, Profiles 0.2.0, APP/Observatory 0.5.0, Local Provider 0.1.0, Native Judge Transport 0.1.0.

## What real S1.7 proved

- Candidate attestation: Host 0.1.12-rc.7 + Life Binding 0.1.1-rc.1 were actually loaded.
- Life completed 18/18 and did not expose a new Binding defect.
- Tutor early turns encountered nonretryable HTTP 400 responses on structured Agent/Judge requests; because the RC6→RC7 diff did not alter Tutor request/schema behavior and later Tutor/Life calls recovered, this is classified as execution-readiness contamination rather than a Provider/Runtime promotion defect.
- Research process segments repeatedly exited on `claim-proposal requires action.claim.id/text`: a valid initial structured claim proposal could be blocked for user-visible prose, then the free structured retry could return `claim-proposal` with `claim=null`; generic Host validation accepted it and mutation-time application threw.
- Because Research failed before establishing a durable active claim, S1.7 did not exercise the planned 14 real tool lifecycle turns; exactly-once qualification is therefore absent for this run rather than failed.

## RC8 changes driven by S1.7

1. **Pre-commit semantic action validation** — `claim-proposal` must carry non-empty `action.claim.id/text` before a response is considered valid.
2. **Pinned structured action repair** — Host-owned Research message repair freezes the prior valid action kind, conclusion mirror, claim and plan; policy repair changes only user-visible prose/rationale.
3. **Retry provenance** — both standard and recoverable retry compilers receive the previous Agent response so a valid action can be preserved.
4. **Exactly-once mutation regression** — an end-to-end orchestrator test covers placeholder-blocked claim establishment → Host-owned retry → one durable claim commit.

## Regression evidence before real S1.8

- Host test suite includes RC8 contract and end-to-end mutation-safety regressions.
- Stable candidate check must remain PASS after packaging.
- Life Binding 0.1.1-rc.1 must remain compatible with RC8.
- S1.8 runner adds structured Agent/Judge execution-readiness canaries before the sustained workload so HTTP 400/model-readiness failures abort before contaminating the 56-turn soak.

## Promotion gate

RC8 is **not Stable**. A clean real S1.8 must first pass execution-readiness, then retain the 56-turn / 17-process / 14-real-tool topology and require Tutor 18/18, Research 20/20, Life 18/18, semantic findings=0 after manual spot-check, Observatory PASS, exactly-once PASS, and correct candidate attestation.

---

# Host Adapter 0.1.12 RC5 — S1.4 Recovery Closeout

## Baseline

- Stable baseline: Host Adapter 0.1.11.
- Candidate: Host Adapter 0.1.12-rc.5.
- Life candidate remains 0.1.1-rc.1.
- Frozen dependencies: Core 0.3.0, Runtime 0.1.0, Profiles 0.2.0, APP/Observatory 0.5.0, Local Provider 0.1.0, Native Judge Transport 0.1.0.

## What real S1.4 proved

- Candidate attestation: Host 0.1.12-rc.4 + Life Binding 0.1.1-rc.1 were actually loaded.
- Topology: 56/56 turns and 17 process segments completed.
- Life: 18/18 delivered; all authorized preference/plan mutations and high-risk boundaries passed.
- Research: 19/20 delivered; durable support/opposing evidence survived restarts and all 14 tool executions remained exactly once.
- Observatory: build/validation and lifecycle topology passed.
- Tutor: 14/18 delivered; RC4 correctly detected multiple task-grounded factual errors, but a second free-form repair could introduce another error or leak an answer.
- Manual audit found one additional delivered Tutor defect: a user requested an unsolved next practice, while the Agent supplied and incorrectly solved a newly invented fraction exercise.
- Research user-visible conclusion mirror mismatches were delivered on blocked/undetermined turns, and a response-envelope leak could recur after free-form retry.

## RC5 changes driven by S1.4

1. **Deterministic Tutor recovery** — `TUTOR_TASK_FACTUAL_ERROR` and `TUTOR_EXCESSIVE_ASSISTANCE` use Host-owned safe copy on retry instead of another unconstrained Agent rewrite.
2. **Unsolved next-practice contract** — when the user explicitly asks for a next exercise/checkpoint without the answer, a worked fraction-arithmetic solution in the same message is deterministically blocked.
3. **Deterministic Research conclusion mirror** — a blocked/undetermined Host state cannot be turned into a user-visible A>B/A<B assertion; questions and hypotheses remain allowed.
4. **Host-owned Research recovery** — conclusion-mirror and response-envelope violations recover to clean Host-owned state-aligned prose.

## Regression evidence before real S1.5

- Host test suite: 112/112 PASS.
- `npm run check`: PASS, including callback live gate.
- S1.4-specific tests cover factual-error safe recovery, unsolved-practice answer withholding, Research direction mismatch, hypothesis/question safe harbor, and clean Research envelope/mirror recovery.
- Existing exactly-once/restart/structured-output/privacy/opposing-evidence tests remain PASS.

## Promotion gate

RC5 is **not Stable**. A real S1.5 must retain the 56-turn / 17-process / 14-real-tool topology and require Tutor 18/18, Research 20/20, Life 18/18, zero semantic findings after manual spot-check, Observatory PASS, exactly-once PASS, and correct candidate attestation. Stable promotion remains evidence-driven.


## RC10 / S1.10Q2 closeout

RC10 adds a same-turn user-visible artifact contract for Research tool-mediated turns. Evidence summaries and validation identity/outcome must be visible after successful materialization; Host-owned retry reuses the durable tool result and does not repeat side effects.


## RC11 / S1.11 closeout

RC11 addresses only defects evidenced by the real S1.11 soak: deterministic Tutor fraction-math validation and actionable next-practice checks, plus Research repair composition that preserves same-turn Host tool artifacts even when the first violation is a different policy code. It also closes explicit requested-evidence visibility, blocked/undetermined negative-direction wording, and “what remains to validate” task-completion gaps. Foundation, Profiles, Provider, Judge transport, and Life Binding are unchanged.
