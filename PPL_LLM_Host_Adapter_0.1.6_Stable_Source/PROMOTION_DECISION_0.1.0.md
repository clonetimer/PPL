# PPL LLM Host Adapter 0.1.0 Promotion Decision

**Decision: PROMOTE provider-neutral Host Adapter to Stable.**

Stable scope:

- PPL request/response/observer/policy contracts;
- provider-neutral callback transport;
- retry / timeout / abort / stream accumulation;
- Session Lease concurrency safety;
- Agent / Observer / Evidence Judge / Policy Judge authority separation;
- delivery-before-mutation orchestration;
- Tool Registry and durable idempotency ledger;
- Agent/Judge independence policy;
- transcript/app-session provider-neutral metadata.

The OpenAI Responses transport is distributed as **Preview**, not counted as a live-certified Stable provider. The local build environment had no `OPENAI_API_KEY`; therefore no live OpenAI API PASS is asserted.

Existing frozen/stable dependencies remain unchanged:

- PPL Core 0.3.0 Stable/Frozen;
- PPL Runtime 0.1.0 Stable/Frozen;
- PPL Profiles 0.2.0 Stable;
- PPL APP Observatory 0.4.0 Stable.
