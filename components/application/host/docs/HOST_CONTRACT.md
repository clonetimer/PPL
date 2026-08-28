# PPL LLM Host Contract 0.1 Stable

## 1. Authority

| Role | May | Must not |
|---|---|---|
| Profile | durable state, policy, evidence semantics, conclusion gate | depend on one LLM provider |
| Agent LLM | generate user-facing behavior and proposals | patch durable state, invent Host facts/evidence |
| Restricted Tutor Observer | score against Host rubric, return partial/unscorable, propose taxonomy-bounded misconception | infer affect without Host observation, change rubric |
| Research Evidence Judge | classify Host-fetched material | create DOI/URL/source, write Evidence Ledger directly |
| Policy Judge | classify output-policy violations | modify Profile policy or durable state |
| Host | own user/tool facts, provenance, delivery and transaction lifecycle | persist LLM self-claims as facts without gates |

## 2. Transaction

`Profile state -> request -> transport completed -> structured parse -> Delivery Gate -> Session Lease -> deterministic Profile mutation`.

No durable mutation is allowed from partial stream output, failed/incomplete transport, timeout, cancellation, `review`, or `block`.

## 3. Session concurrency

The default Stable mode uses a **Session Lease** around the full state-to-commit transaction. A concurrent mutation request for the same Session returns `session-busy`; it is not queued with a stale state snapshot. The caller must fetch/use the latest durable state and retry.

## 4. Transport

Provider-neutral transports expose `invoke()` and/or `stream()`. The Stable resilience layer provides bounded retries, timeout, outer abort, attempt audit, and same-call trace IDs.

Streaming deltas are observable but never call Profile mutation APIs. Only the finalized stream enters structured validation and the Delivery Gate.

## 5. Tools

`Model tool proposal -> Host allowlist -> argument schema -> ToolExecutionLedger -> Host execution -> provenance-locked result`.

Tool results do not automatically become Tutor learner evidence or Research evidence.

Stable ToolExecutionLedger supports a memory store and an atomic JSON-file store. The file store makes same-call replay protection survive Host restart:

- same `callId + name + arguments` returns the original result;
- same `callId` with changed name/arguments is rejected.

## 6. Agent/Judge independence

`required`: Agent and Judge must use different `independenceGroup` values or adapter creation fails.

`preferred`: same-group operation is allowed but emits an audit warning. This is the mode used for the current ChatGPT GPT-5.6 Sol live semantic gate because Agent and Judge are the same underlying model with isolated authority contexts.

`disabled`: no independence assertion.

## 7. Provider scope

The Stable contract is provider-neutral. The included OpenAI Responses transport is a **Preview provider**: its HTTP/SSE/Structured Output/function-call protocol behavior is locally conformance-tested, but a live API smoke test was not run in this build environment because no API key is present.
