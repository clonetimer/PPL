# PPL Experience Rule Evolution 0.2.0 Stable

This component extends the 0.1 Stable deterministic Experience Rule runtime with **offline evolution governance**. It keeps PPL authority above experience-derived assets and does not enable online self-modification.

## 0.2 scope

- Unified `ExperienceEvaluation`: provenance-bound hard gates + multi-objective metrics.
- Promotion policy: required evidence classes, hard-gate vetoes, weighted soft objectives, regression budgets and risk-class human approval.
- Candidate lineage: parent links, generation ordering, mutation/operator metadata and source episode hashes.
- Lifecycle ledger: `candidate -> qualified -> validated -> superseded/retired`, plus explicit rollback states.
- Convergence detection: stop evolution after configurable generations without material fitness improvement.
- Restore-best planning: deterministic ranking and rollback to the best previously qualified/validated candidate.
- Promotion binding: only the exact reviewed candidate asset hash may be promoted.

## Deliberate non-goals

This Stable release does **not**:

- rewrite prompts online;
- mutate Host/Runtime/Profiles during user requests;
- automatically modify workflow DAGs in production;
- change `Host 0.1.13 Stable` or the Frozen Foundation;
- make synthetic evidence eligible when a promotion policy excludes it.

## Authority model

Experience-derived candidates remain advisory/offline until the normal PPL path promotes them. Production `enforce` mode still accepts only `validated` runtime rules.

## Main APIs

```js
import {
  buildExperienceEvaluation,
  buildPromotionPolicy,
  reviewPromotionCandidate,
  createEvolutionCandidate,
  buildEvolutionLedger,
  applyEvolutionTransition,
  detectEvolutionConvergence,
  planRestoreBest,
} from '@ppl/experience-rule-evolution'
```

### Evaluation

```js
const evaluation = buildExperienceEvaluation({
  asset: { assetType: 'rule', assetId: 'rule_x', version: '0.2.0-candidate.1' },
  evidenceClass: 'real-soak',
  sampleCount: 56,
  evidenceSha256: ['...64 hex...'],
  hardGates: {
    'authority-inversion': true,
    'state-corruption': true,
    'user-visible-leakage': true,
  },
  metrics: {
    deliveryRate: { direction: 'maximize', candidate: 1.0, baseline: 1.0 },
    judgeCallsOnKnownBadDraft: { direction: 'minimize', candidate: 0, baseline: 1 },
  },
  findings: [],
})
```

Hard gates are vetoes; soft objectives cannot compensate for a failed hard gate.

### Lineage and rollback

Every candidate is bound to the SHA-256 of the proposed asset and records its parent(s), generation, operator and source episodes. `planRestoreBest()` can select a previously `superseded` validated candidate when a newer candidate underperforms, but it only emits a transition plan; it does not rewrite production assets by itself.

## EvoX reference boundary

The 0.2 governance design is conceptually informed by Leavesfly/EvoX's unified evaluation feedback, convergence/history and restore-best ideas. No EvoX code is vendored or required at runtime; PPL intentionally changes the execution model from online self-evolution to offline candidate qualification under PPL authority.
