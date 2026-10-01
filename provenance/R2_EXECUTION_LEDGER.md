# R2 Execution Ledger — 2026-09-30

## Scope

R2 adds real execution interfaces without merging Vertical business schemas.

## Implemented

1. Added `platform/execution`.
2. Reused Stable Host transport resilience and ToolExecutionLedger primitives.
3. Bridged Stable OpenAI-compatible Local Provider source without modifying its Stable component source.
4. Added HTTP JSON and SearXNG retrieval adapters.
5. Added Generic Agent execution + receiver MAG fidelity gate.
6. Added Host-owned tool-call allowlist, validation, exactly-once ledger, and continuation.
7. Added Research Retrieval → Extraction → Analyst → Reviewer → Bound Delivery Judge → deterministic delivery.
8. Added unified Gateway `/execute` routes.
9. Added deterministic tests and real localhost HTTP end-to-end smoke.
10. Added live endpoint probe scripts.

## Observed / fixed during R2

- Gateway route editing briefly wired Research `/execute` to Agent execution. A dedicated gateway execution regression was added after correction.
- Existing LM Studio Native Judge contract is policy-specific and was deliberately not reused as a MAG bound-delivery Judge.
- New Research state remains single-writer: Stable Host orchestration is not layered on top of the new Vertical state owner.

## External live probe

Build environment probe results:

- `127.0.0.1:8000/v1/models`: unreachable;
- `127.0.0.1:8001/v1/models`: unreachable;
- `127.0.0.1:1234/v1/models`: unreachable.

Therefore no external Qwen/vLLM/LM Studio model is claimed live-qualified by R2. `RUN_R2_LIVE_PROBE.*` is provided for deployment-side qualification.

## Final hardening before dev.3 packaging

- Added RecordStore-backed persistence for completed Stable Host ToolExecutionLedger entries.
- Scoped provider tool call ids inside the product ledger while preserving original provider call ids in model continuations.
- Added explicit caveat: R2 does not claim atomic exactly-once recovery across the side-effect→ledger-persist crash window.
- Added retrieval prompt-injection boundary: retrieved text is untrusted data, never executable instruction.
- Extended localhost HTTP smoke with two injected failures:
  - analyst counter-evidence erasure → `blocked-analyst-fidelity` / `COUNTER_EVIDENCE_ERASURE`;
  - semantic Judge rejection → `blocked-by-semantic-judge`.
- Added Agent/Research execution history endpoints.
- Expanded release qualification to Stable Host, Local Provider, and Native Judge regressions.
