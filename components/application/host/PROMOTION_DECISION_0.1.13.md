# PPL LLM Host Adapter 0.1.13 Stable Promotion

Date: 2026-08-26

## Decision

**PASS — promote `0.1.13-rc.2` to `0.1.13 Stable`.**

## Evidence

- Candidate stack attestation: PASS.
- Dynamic Judge qualification/readiness/model residency: PASS.
- Tutor 18/18, Research 20/20, Life 18/18.
- Research tool materialization: 14/14 exactly-once.
- Semantic findings: 0.
- Observatory gates: PASS.
- Experience Rule evaluation: 42 evaluations, 4 matched drafts, 4 pre-Judge fast-paths on Research turns 5/9/18/20.
- Unknown failures remain Judge-gated; Life is not targeted.
- Final user-visible text review: PASS.

## Promotion invariants

- `src/` and `profiles/` are byte-identical to `0.1.13-rc.2`.
- Default `experienceRuleMode` remains `off`.
- `enforce` mode requires `status=validated`.
- Installing the Host does not silently activate any rule.
- No Core/Runtime/Profiles/Provider/Observatory/Judge Transport/Life Binding changes are part of this promotion.
