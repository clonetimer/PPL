# Life Host Contract 0.1.1 Stable

`Host facts/risk + Life durable state -> Life LLM request -> structured proposal -> Host validation -> deterministic Profile event`.

## Durable-state boundary

Realtime facts remain Host-owned and transient. Preferences/plans can mutate only through an authorized structured proposal and the existing deterministic Profile event path.

## High-risk user-visible boundary

When `hostRisk.level=high`:

- the only action is `life-escalation`;
- `escalation.required` must be `true`;
- `responseContract.requiredMessage` is a Host-owned safe escalation copy;
- `message` must match that copy exactly.

This closes the S1 failure where the action correctly escalated while the natural-language message still supplied a definitive professional conclusion.

## Explicit mutation intent

`requiredActionKind` is optional. When supplied, it must already be included in the action kinds authorized by Host risk and `mutationAuthorization`. It therefore cannot create new mutation authority. The S1.1 harness may use it to bind an explicit authorized plan/preference commit to the corresponding proposal action.
