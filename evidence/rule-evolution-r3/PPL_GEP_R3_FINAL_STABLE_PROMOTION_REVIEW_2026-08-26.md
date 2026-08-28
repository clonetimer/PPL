# PPL GEP Rule Evolution R3 — Final Stable Promotion Review

Date: 2026-08-26

## Decision

**PASS**

Promote:
- `@ppl/experience-rule-evolution 0.1.0-rc.1` -> **0.1.0 Stable**
- `ppl-llm-host-adapter 0.1.13-rc.2` -> **0.1.13 Stable**
- `rule_research_conflict_erasure_prejudge_fastpath` -> **version 0.1.0 / status=validated**

Keep unchanged:
- Life Binding 0.1.1 Stable
- Provider 0.1.0 Stable
- Core 0.3.0 Frozen
- Runtime 0.1.0 Frozen
- Profiles 0.2.0 Stable
- APP/Observatory 0.5.0 Stable
- Judge Transport 0.1.0 Stable

## Real R3 gates

- Candidate attestation: PASS
- Judge qualification / readiness / model residency: PASS
- Tutor: 18/18
- Research: 20/20
- Life: 18/18
- Research tools: 14/14 exactly-once
- Semantic findings: 0
- Observatory: PASS
- Experience Rule evaluations: 42
- Matched drafts: 4
- Pre-Judge fast-paths: 4
- Real fast-path turns: Research 5, 9, 18, 20
- Manual visible-text review: 56/56 PASS

The real R3 run therefore exercised the candidate rule rather than merely demonstrating no-regression with zero matches.

## Rule behavior observed

For each of Research 5/9/18/20:
1. the first structurally valid draft triggered Host-owned `RESEARCH_CONFLICT_ERASURE`;
2. the candidate Experience Rule matched that deterministic code;
3. the known rejected draft skipped one redundant external Judge call;
4. Host-owned `compileRetryRequest` produced the repair request;
5. the repaired draft re-entered normal delivery gating;
6. final user-visible output preserved opposing evidence and passed semantic closeout.

The rule does not target Life and does not capture unknown policy codes.

## Manual visible-text review

All 56 delivered messages were reviewed. No user-visible PPL/Judge/Experience Rule contract leakage was found. Tutor answers retained the no-final-answer boundary, Research outputs preserved Host-owned counter-evidence and calibrated the final `qualified/support` state, and Life replies respected realtime-fact, mutation-authorization, and high-risk boundaries.

## Promotion integrity

- Host `src/ + profiles/` aggregate SHA-256 is byte-identical from RC2 to Stable.
- Experience Rule Evolution `src/` aggregate SHA-256 is byte-identical from RC1 to Stable.
- Stable promotion changes release metadata/dependency versioning and promotes the separately provenance-bound rule lifecycle from candidate to validated.
- Host default `experienceRuleMode` remains `off`; Stable installation does not silently activate rules.
- Production `enforce` accepts only validated rules.

## Evidence identity note

`PPL_SUSTAINED_SOAK_S1_12_RESULTS(4).zip` and `PPL_RULE_EVOLUTION_R3_RESULTS.zip` have the same SHA-256:

`f265cff94345a07facafbf155f695b6ba44c881be3a72b75ab16fbf553158caa`

They are the same result payload and are not counted as two independent runs.
