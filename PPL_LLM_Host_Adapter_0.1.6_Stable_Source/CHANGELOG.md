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
