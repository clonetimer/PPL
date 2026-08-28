# PPL LLM Host Adapter 0.1.13 Stable

**Status:** Stable Application Mainline Host, promoted from `0.1.13-rc.2` after real R3 Rule Evolution qualification.

The Stable build preserves the RC2 runtime source byte-for-byte. It adds no runtime logic during promotion. The only dependency promotion is `@ppl/experience-rule-evolution 0.1.0-rc.1 -> 0.1.0 Stable`, whose runtime source is also byte-identical to its RC.

## R3 promotion evidence

- candidate attestation/readiness/Judge qualification: PASS
- Tutor 18/18, Research 20/20, Life 18/18
- Research tools 14/14 exactly-once
- semantic findings: 0
- Observatory: PASS
- Experience Rule evaluations: 42
- real matched drafts / fast-paths: 4 / 4 (Research turns 5, 9, 18, 20)
- unknown-failure Judge path invariant: PASS
- final repaired drafts remained subject to Host/Judge delivery gating
- manual user-visible review: PASS

## Stable behavior

`experienceRuleMode` remains `off` by default. `enforce` mode accepts only `status=validated` rules. No rule is silently activated by installing the Host package.

## Scope retained from the 0.1.12 RC line

0.1.12 hardens Tutor and Research user-visible delivery, structured-output repair, Host-owned policy recovery, Research provenance/tool lifecycle, certainty/conflict disclosure, recoverable continuation, and task-completion gates. See `CHANGELOG.md`, `docs/RC_0.1.12.md`, and `PROMOTION_DECISION_0.1.12.md` for the full history.

## Validation

Run:

```bash
npm ci --offline
npm test
npm run check
```


## 0.1.13 Experience Rule Evolution

This RC is rebuilt from the 0.1.12 Stable runtime baseline. It does **not** carry the failed runtime Gene Overlay experiment. Instead it can load provenance-bound deterministic Experience Rules. In evaluation/enforce mode, a matched Host deterministic policy violation may trigger Host-owned repair before the external Judge; unknown failures still go to the Judge.
