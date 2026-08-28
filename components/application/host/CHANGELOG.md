# Changelog

## 0.1.13 — 2026-08-26
- Promoted `0.1.13-rc.2` to Stable after real R3 full-Application qualification.
- No Host runtime/profile source changed during promotion.
- Experience Rule runtime dependency promoted to `@ppl/experience-rule-evolution 0.1.0 Stable` with identical runtime source.
- Default rule mode remains `off`; production `enforce` requires a separately validated rule asset.

## 0.1.13-rc.2
- Rebased on 0.1.12 Stable; runtime advisory Gene Overlay is removed from the candidate path.
- Adds optional Experience Rule Evolution dependency and pre-Judge deterministic fast-path.
- Adds fail-closed structural retry before Judge.
- Candidate rules require explicit evaluation mode; enforce mode accepts validated rules only.

# PPL LLM Host Adapter Changelog

## 0.1.12 — 2026-08-25

- Promoted `0.1.12-rc.11` to Stable after real S1.12 Q5 passed all release gates.
- No runtime/source behavior change from RC11; promotion-only metadata/documentation update.
- Final evidence: Tutor 18/18, Research 20/20, Life 18/18, Research tools 14/14 exactly-once, semantic findings 0, Observatory PASS, restart/recoverable state PASS, manual user-visible review PASS.

# Changelog

## 0.1.12-rc.11

- Promote Tutor fraction-equivalence/arithmetic correctness from post-soak evaluator to deterministic Host delivery gate.
- Tighten next-practice/checkpoint actionability: a next task must provide concrete operands, ask the learner to construct operands, or pose a substantive conceptual checkpoint.
- Preserve same-turn Research tool artifacts across any Host-owned policy repair, including when the first violation is conclusion-mirror mismatch.
- Extend Research conclusion mirror detection to explicit negative directional claims such as “Method A is not more stable than Method B”.
- Require explicitly named evidence IDs (for example evidence:B、D、G) to remain user-visible when the user asks not to erase them.
- Require a concrete remaining validation/independent-evidence need when the user explicitly asks what still needs validation.

## 0.1.12-rc.10

- Require same-turn Host-owned Research evidence/validation artifacts to be surfaced in user-visible prose.
- Add `RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE` deterministic policy gate.
- Preserve exactly-once tool execution while Host-owned retry surfaces the materialized artifact and required opposing evidence.
- S1.10Q2 evidence basis: tool turns could commit correct durable evidence while the visible response omitted the new artifact.

# 0.1.12-rc.9 — 2026-08-23

S1.8 user-visible task-completion closeout RC. Stable baseline remains **0.1.11**.

- Added deterministic `TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE`: when the learner explicitly asks for a next exercise/checkpoint, meta-commentary about arranging one is not sufficient; user-visible output must contain an actionable learner task/checkpoint.
- Added `RESEARCH_CLAIM_NOT_VISIBLE`: a `claim-proposal` must surface the exact Host-accepted canonical claim text in the user-visible message instead of hiding the hypothesis only in structured action state.
- Both violations use Host-owned repair paths and participate in Host-owned-message Judge false-positive suppression.
- Real S1.8 retained strong infrastructure evidence: readiness PASS, 56/56 delivery, 14/14 Research tool events exactly-once, Observatory PASS. Promotion remains HOLD because strengthened manual/semantic backstop found 9 user-visible task-completion findings across Tutor, Research, and Life.
- No Core, Runtime, Profiles, Observatory, Provider, Judge Transport, or durable-state semantics changed.

# 0.1.12-rc.8 — 2026-08-23

S1.7 Research Mutation-Safety Closeout RC. Stable baseline remains **0.1.11**.

- Research `claim-proposal` payloads are now semantically validated before any durable mutation; `action.claim.id/text` cannot be deferred to a later commit-time throw.
- Host-owned Research policy repair preserves the previously valid structured action and pins `kind`, conclusion mirror, claim, and plan while replacing only user-visible prose/rationale.
- Standard and recoverable retry paths now carry the previous Agent response into the constrained repair compiler.
- End-to-end orchestrator regression proves placeholder-blocked claim establishment retries without losing/replacing the claim and commits exactly once.
- Real S1.7 evidence retained: Life 18/18; Tutor transport HTTP 400 failures were not accompanied by a Tutor contract/source change from RC6→RC7 and are treated as an execution-readiness signal rather than evidence to reopen Provider/Runtime. Research process exits exposed the pre-commit action-validation gap.
- No Core, Runtime, Profiles, Observatory, Provider, Judge Transport, or Life Binding semantics changed.

# 0.1.12-rc.7 — 2026-08-22

S1.6 Research Recovery Closeout RC. Stable baseline remains **0.1.11**.

- Research `RESEARCH_CERTAINTY_OVERREACH` now enters Host-owned state-aligned repair, closing the S1.6 Turn 19 overreach → free retry → envelope-leak terminal path.
- Added deterministic `RESEARCH_USER_VISIBLE_PLACEHOLDER` so internal action/workflow labels such as `research-plan` and `report-with-profile-caveats` cannot be delivered as the entire user-visible answer.
- Added `RESEARCH_PROVENANCE_MISATTRIBUTION`; Policy Judge context now carries validation method/confidence plus evidence source title so cross-wired evidence/validation provenance can be detected.
- Host-owned Research repairs cover certainty-overreach, placeholder, provenance-misattribution, conclusion-mirror, envelope-leak, and mandatory conflict disclosure without another free-form Agent rewrite.
- Real S1.6 evidence retained: Tutor 18/18, Life 18/18, 14/14 Research tool executions exactly-once, Observatory PASS; Stable promotion held on Research Turn 19 plus manual user-visible Research findings.
- No Core, Runtime, Profiles, Observatory, Provider, Judge Transport, or Life Binding semantics changed.

# 0.1.12-rc.6 — 2026-08-22

S1.5 Tutor Recovery Closeout RC. Stable baseline remains **0.1.11**.

- Tutor response-envelope violations now enter the same Host-owned repair path used for factual/final-answer/private-state/excessive-assistance failures; the second draft is no longer a free 0.8B rewrite.
- When the user explicitly requests a new unsolved practice/checkpoint, the Host-owned repair is task-aligned and withholds the final sum instead of sending the learner back to the just-completed item.
- Host-owned Tutor messages ignore unsupported Judge `MODEL_RESPONSE_ENVELOPE_LEAK`/factual false positives unless the Host deterministic gate independently found the same violation.
- Real S1.5 evidence retained: Research 20/20, Life 18/18, 14/14 tool executions exactly-once, Observatory PASS; only Tutor turns 12 and 15 were blocked by the envelope-leak → free-repair → Judge-false-positive gap.
- No Core, Runtime, Profiles, Observatory, Provider, Judge Transport, Research, or Life Binding semantics changed.

# 0.1.12-rc.5 — 2026-08-22

S1.4 Recovery Closeout RC. Stable baseline remains **0.1.11**.

- Tutor factual-error and excessive-assistance policy repairs now use Host-owned safe learner-facing copy rather than a second unconstrained Agent rewrite.
- Deterministically blocks worked fraction-arithmetic solutions when the user explicitly asks for a next practice/checkpoint without the answer.
- Research blocked/undetermined user-visible directional assertions are deterministically checked against Host conclusion state, with question/hypothesis safe harbor.
- Research conclusion-mirror and response-envelope retries now use Host-owned clean prose.
- S1.4 evidence retained: Life 18/18, Research durable evidence and 14/14 exactly-once tool execution remained healthy; Stable promotion was held on Host user-visible recovery semantics.
- No Core, Runtime, Profiles, Observatory, Provider, Judge Transport, or Life Binding semantics changed.


## 0.1.12-rc.4

- Added optional Host-verified Tutor ground-truth and pinned user-visible message support.
- Prevented impossible Judge false positives from blocking Host-owned Tutor safe copies.
- Added Research user-visible conclusion mirror mismatch policy.
- Deterministically blocks embedded response/action envelope fragments in user-visible messages.
- Strengthened Tutor factual Judge instructions against verified task ground truth.
# 0.1.12-rc.3 — 2026-08-21

S1.2 Tutor Closeout RC. Stable baseline remains **0.1.11**; Research/Life closed in S1.2 but Tutor did not qualify for promotion.

- Tutor generation receives Profile-selected pedagogical policy rather than raw learner posterior/counters by default; explicit Host authorization still exposes the full summary.
- Tutor response contracts bound initial message/rationale size; structured Agent retries tighten the contract instead of replaying the same oversized request.
- Policy Judge evidenceQuote candidates are exact contiguous spans capped at 220 characters, with deterministic Host findings prioritized; Judge structured repair requires short evidence/rationale and complete JSON.
- Host-owned Tutor privacy retry copy is neutral learner-facing text and no longer names internal-state/privacy policy concepts.
- Tutor Judge context now includes task, user message and rubric, plus Host-owned `TUTOR_TASK_FACTUAL_ERROR` for clear task-grounded mathematical/factual errors.
- Recoverable tool retry, compact checkpointing and exactly-once semantics from RC2 remain unchanged.
- No Core, Runtime, Profiles, Observatory, Provider, Judge Transport or Life Binding semantics changed.
- Qualification remains **HOLD** pending a full real S1.3 closeout on corrected `fractions.addition` scenarios.

# 0.1.12-rc.2 — 2026-08-21

S1.1 Closeout RC. Stable baseline remains **0.1.11**; S1.1 did not qualify for promotion.

- Recoverable tool-mediated lifecycle now has the same bounded Host-owned policy retry semantics as the standard Agent lifecycle. A blocked post-tool draft reuses durable tool results and never re-executes the side effect.
- Agent and Policy Judge structured-output parsing now get one bounded same-contract retry by default (`maxStructuredOutputRetries=1`); constraints are not weakened and no durable mutation occurs before a valid, policy-approved response.
- Tutor private-state guard now covers Profile implementation identifiers such as `misconceptions.*` and misconception/confidence disclosures observed in S1.1 Turn 14.
- Structured-output parse audit retains the failed transport result for diagnosis.
- No Core, Runtime, Profiles, Observatory, Provider, Judge Transport, Judge taxonomy, or Life Binding semantics changed.
- Qualification remains **HOLD** pending a full S1.2 closeout soak with the Application harness wired to Life `requiredActionKind` and dynamic candidate-version attestation.

# 0.1.12-rc.1 — 2026-08-21

S1 Semantic Closeout RC. Stable baseline remains **0.1.11** pending a real LM Studio S1.1 soak.

- Research: recognize Profile `report-*` next actions; an explicit user report request requires `action.kind=report`.
- Research: user-requested opposing/counter-evidence visibility is now a deterministic Host contract for both `research-plan` and `report`; `all` requires every currently available opposing summary.
- Tutor: deterministic `TUTOR_INTERNAL_STATE_DISCLOSURE` guard blocks unauthorized quantitative mastery/uncertainty/assessment/verifier state in user-visible text, with Host-owned restricted repair.
- Recoverable turn store: first checkpoint stays full; later checkpoints use revision-checked top-level deltas while legacy full-checkpoint JSONL remains readable. Replaying S1 Research reduced 3,600,163 bytes to 829,649 bytes (76.96%).
- No Core, Runtime, Profiles, Observatory, Provider, Judge Transport, or Judge taxonomy semantics changed.

# 0.1.11 Stable — 2026-08-21

- Promoted after the real R10 LM Studio restricted-repair gate passed.
- Tutor final-answer-leak retry is constrained to Host-owned safe user-visible copy and fixed rationale while still executing through the live 0.8B Agent and independent 9B Judge.
- Research conflict-disclosure retry is constrained to Host-owned natural-language disclosure that includes real opposing evidence and excludes internal policy/retry meta language.
- R10 live evidence: both targeted repair flows delivered; Agent/Judge reasoning tokens were zero; finish_reason was stop; counter-evidence remained retained.
- No PPL Core, Runtime, Profiles, Observatory, Provider, Judge taxonomy, or Life Binding semantics changed.

# 0.1.11-rc.1

- Restricts Tutor final-answer-leak policy retries to a Host-owned safe user-visible message enum and fixed rationale enum.
- Restricts Research conflict-disclosure retries to a Host-owned natural-language disclosure message that includes real opposing evidence and excludes internal policy/retry meta language.
- Keeps Host-side schema validation authoritative even when provider-side structured output is imperfect.
- Historical RC note: Stable baseline remained 0.1.7 until live R10 qualification.

# Changelog

## 0.1.10-rc.1

- Bound Tutor policy-retry `action.rationale` to 160 characters in addition to the existing 480-character message bound.
- Added deterministic Research report conflict-disclosure guard when Host state contains opposing evidence.
- Research conflict-erasure retry now requires one Host-owned opposing evidence summary verbatim in the user-visible message.
- No Core/Runtime/Profile semantics changed.

## 0.1.9-rc.1 — 2026-08-21

- Add a deterministic Tutor guard for explicit relational/equality disclosure of a configured final-answer token.
- Bound independent Policy Judge rationale to 320 characters to prevent structured-output truncation.
- Add Research safe-harbor semantics: planning further work while blocked/undetermined is not certainty overreach; explicitly retaining counter-evidence is not conflict erasure.
- Strengthen Research conflict-erasure retry guidance with Host-owned opposing evidence summaries.

## 0.1.8-rc.1 — 2026-08-20

- Application-driven contract convergence from the real R6 run; 0.1.7 Stable remains the baseline until live R7 qualification.
- Constrain Judge `evidenceQuote` to Host-generated exact spans from `agentMessage`.
- Include complete Host Research epistemic context plus same-turn durable tool artifacts in the policy Judge request.
- Scope Research response actions to the current workflow and mirror Host-owned conclusion status/direction directly in the response JSON Schema.
- Strengthen policy retry requests with the exact blocked code/quote and bound Tutor retry messages to prevent repetitive retry loops.
- Preserve Core/Runtime/Profiles/Observatory/Life semantics and all recoverable lifecycle/tool idempotency behavior.

## 0.1.7 Stable — 2026-08-20

- Promoted after real R4 application evidence. Application-driven fix: Tutor/Research Host requests now carry Host-owned JSON Schema response contracts.
- Research citations are restricted at generation time to exact Host evidence/validation locators; when none are available citations must be empty.
- Tutor policyMode is constrained to the current Profile policy in the response schema.
- Host re-validates model output against the same responseContract before domain-specific checks.

# 0.1.6 Stable — 2026-08-20

Promoted the 0.1.6 application line after the real RC10 LM Studio lifecycle gate passed.

- Productized `runRecoverableToolMediatedAgentTurn(...)` with durable turn checkpoints.
- Preserved exactly-once tool semantics across the real crash window after ToolExecutionLedger fsync and before the turn checkpoint advances.
- Added state-digest and request-identity fail-closed resume guards.
- Added committed-turn zero-execution replay.
- Retained role-scoped Independent-Judge taxonomy, Host-owned severity, exact-quote validation, and Host-side responseContract validation.
- Live-qualified topology for promotion: Qwen3.5-0.8B Agent/Local Provider + Qwen3.5-9B LM Studio Native Judge (`reasoning=off`).
- OpenAI Responses provider remains Preview pending live API certification.
- No PPL Core, Runtime, Profiles, or Observatory semantics changed.

## 0.1.5-rc.1

- Validate the Host-owned Judge responseContract locally even when a provider can only enforce json_object rather than json_schema.
- Enforce required, enum, additionalProperties, array items, string length, numeric bounds, and anyOf for the contract subset used by PPL.
- Keep Judge taxonomy, Host-owned severity, independence, and fail-closed delivery unchanged.

# 0.1.4-rc.1

- Scope Independent Judge policy codes by `modelRole` instead of exposing Tutor and Research taxonomies simultaneously.
- Publish Host-owned semantic definitions for every allowed Judge policy code.
- Move policy `severity` ownership out of the model response and into the Host taxonomy; Judge wire schema is now `ppl.gpt-policy-judge-response/0.2`.
- Materialize severity only after Judge response validation.
- Keep exact contiguous `evidenceQuote`, confidence gating, and fail-closed invalid-output behavior.
- Preserve non-completed Judge transport metadata in RC7 live certification diagnostics.
- No changes to PPL Core, Runtime, Profiles, Local Provider Stable, or durable tool-ledger semantics.

# 0.1.2-rc.1

- Retains the 0.1.1 Tutor deterministic final-answer leak false-positive fix.
- Adds `AppendOnlyJsonlToolExecutionStore`, a durable ToolExecutionLedger backend that appends one fsynced JSONL record per mutation instead of rewriting the entire ledger JSON on every unique call.
- Keeps `JsonFileToolExecutionStore` unchanged for compatibility.
- Carries forward the separate OpenAI Responses Provider RC1 Preview implementation (manual `function_call_output` continuation, tool controls, recursive strict-schema checks, live certification runner); Provider live certification remains pending.
- Does not add unsafe automatic expiry: durable replay semantics still retain call identity/result unless the Host explicitly deletes a call id.

# Changelog

## 0.1.0 Stable

Promoted the provider-neutral Host Adapter after transport, streaming, session-lease, durable tool-idempotency, package-isolation, and live GPT semantic gates passed. No PPL Core/Runtime/Profiles semantics changed. The OpenAI Responses provider remains Preview pending a live API-key smoke test.


## 0.1.0-rc.1

Promotes the former GPT Host Lab toward a reusable provider-neutral LLM Host Adapter.

Added:

- resilient invoke lifecycle: retry, timeout, cancellation;
- streaming accumulator with explicit no-partial-mutation contract;
- single-writer Profile Session coordinator;
- Tool Registry, argument validation, Host provenance, and idempotent ToolExecutionLedger;
- reusable `PplLlmHostAdapter` orchestration;
- Agent/Judge model-independence policy;
- optional OpenAI Responses API provider with Structured Outputs, streaming and function-call event mapping;
- protocol-level local HTTP/SSE provider tests.

Preserved from GPT Host Lab rc.2:

- restricted Tutor Observer;
- Research Evidence Judge with immutable HostSource provenance;
- Agent Policy Judge and deterministic guards;
- retry that preserves Profile policy;
- `tutor-nonintervention` semantics.

## 0.1.1-rc.1 — 2026-08-19

- Hotfix RC for Tutor deterministic final-answer false positives when expected-answer tokens are already present in the learner/task prompt.
- Added explicit rubric `leakPatterns` deterministic guard.

## 0.1.6-rc.1
- Add recoverable tool-mediated Agent lifecycle and append-only durable turn store.
- Resume validates state digest and input identity.
- Crash between tool ledger fsync and turn checkpoint replays tool result without repeating side effect.
- Committed and terminal turns replay without model/tool execution.
