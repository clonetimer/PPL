# PPL Life Host Binding Changelog

## 0.1.1 — 2026-08-25

- Promoted `0.1.1-rc.4` to Stable after real S1.12 Q5 closeout.
- No runtime/source behavior change from RC4; promotion-only metadata/documentation update.
- Final evidence: Life 18/18, invariant pass rate 1.0, semantic findings 0, Observatory PASS, manual user-visible review PASS.

# Changelog

## 0.1.1-rc.4

- Pin explicitly authorized plan/preference proposal payloads in the Life response contract.
- Reject a proposal that reuses an old durable plan instead of the newly authorized plan.
- Add Host-owned mutation fallback for an explicit, already-authorized plan/preference payload.
- S1.10Q2 evidence basis: Life Turn 10 selected the correct `life-plan-proposal` action but proposed the previous plan, producing a no-op commit.

# 0.1.1-rc.3

- Added Host-owned normal-service fallback support for deterministic recovery after invalid Life service generation.
- Added user-visible internal Life contract/meta identifier rejection.
- Retained RC2 echo-only rejection and RC1 risk/mutation contracts.

# Changelog

## 0.1.1-rc.2 — 2026-08-23

- Retains RC1 Host-owned high-risk message and explicit `requiredActionKind` mutation intent.
- Adds a narrow user-visible service-completion guard: `life-service-response` cannot merely echo the full user request or a long suffix of it.
- Authorized plan/preference proposal messages are not rejected by the service echo rule.
- Derived from real S1.8 Life turns 2/6/8/12/13/14/18, where durable-state and risk contracts were correct but the delivered service text did not actually answer/confirm the request.
- Stable baseline remains 0.1.0 pending a clean real S1.9.

## 0.1.1-rc.1 — 2026-08-21

- Add Host-owned exact high-risk user-visible escalation message.
- Add optional `requiredActionKind` constrained to already-authorized action kinds.
- Add S1 regressions for high-risk definitive-message leakage and explicit plan intent.
- Stable baseline remains 0.1.0 pending live sustained qualification.
