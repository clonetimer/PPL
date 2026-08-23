# PPL Profiles 0.2.0 Stable — Application Evolution Report

**Date:** 2026-08-19  
**Status:** Release Candidate, not Stable

## 1. Why 0.2 exists

0.1 proved that Profile can express long-lived application state, deterministic rules, staged resolution, commit/rollback and Observatory export. 0.2 asks a harder question:

> Can the same Profile line survive real Tutor and Research semantics without collapsing uncertainty/evidence into decorative prompt fields?

The answer at RC1 is: the application layer can carry substantially richer semantics without modifying PPL Core 0.3 or Runtime 0.1, but real-world promotion evidence is not yet complete.

## 2. Tutor evolution

### Implemented

- uncertainty-aware skill state: Beta posterior engineering baseline;
- direct vs assisted assessment evidence weighting;
- stable evidence id / duplicate rejection;
- misconception evidence accumulation;
- affect observation confidence gate;
- pedagogy recommendation derived from mastery + uncertainty + misconception;
- intervention ledger;
- turn-by-turn verifier;
- ASSISTments-compatible adapter with inspection, student/skill filtering, chronology and row limits.

### Deliberate limits

- Beta posterior is not claimed to reproduce UKT or to achieve SOTA KT prediction;
- repository CSV is a documented-schema fixture, not a real student trace;
- the Profile does not fabricate action-level hint sequences absent from row-level data;
- Host owns exercise generation and learner observation collection.

### Current deterministic application result

The bundled application-cycle has 10 snapshots; the final snapshot is intentionally aborted. The durable state before that abort preserves:

- mastery mean: `0.4124`
- uncertainty: `0.5972`
- effective evidence weight: `3.87`
- direct assessments: `4`
- assisted assessments: `1`
- verifier checks: `2`
- verifier effectiveness: `0.6875`
- misconception remains `candidate` rather than being cleared after a few successes.

These values are scenario state, **not calibrated learning-performance claims**.

## 3. Research evolution

### Implemented

- explicit question anchor;
- claim lifecycle;
- evidence ledger with stable ids;
- support / oppose / neutral separation;
- source independence groups and correlation downweight;
- stable-locator provenance gate;
- validation ledger separate from hypothesis generation;
- validation kind + strong-validation distinction;
- reproducibility signal;
- `blocked / inconclusive / qualified / ready` conclusion gate;
- conflict and uncertainty preservation.

### Important RC1 correction

An earlier draft could make a literature cross-source consistency check count as enough reproducible support to reach `ready`. RC1 deliberately rejects that shortcut.

`literature-triangulation` can support a **qualified** report, but `ready` requires a strong validation kind such as `replication`, `experiment`, or `formal-check` under the reference policy.

The bundled primary-literature application therefore ends at:

```text
conclusionStatus = qualified
reason = strong-validation-required
```

rather than manufacturing a `ready` result for demonstration purposes.

### Current deterministic application result

- evidence count: `3`
- independent support groups: `3`
- support mass: `3.177`
- oppose mass: `0`
- uncertainty: `0.2394`
- validation attempts: `1`
- strong validation support: `0`
- final durable conclusion: `qualified`
- final correlated evidence turn: intentionally aborted and not persisted.

Support mass and uncertainty are audit-oriented Profile accounting values, not probabilities of scientific truth.

## 4. Literature → mechanism, not literature → feature checklist

Tutor mechanisms were informed by work arguing for uncertainty-aware knowledge-state representations and separate turn-level tutoring verification. Research mechanisms were informed by hypothesis-generation benchmarks and research-agent work that separate generation, experiment/validation and analysis, plus work showing plausible generated hypotheses can still be untruthful.

The implementation does **not** copy those models. It extracts reusable engineering constraints: uncertainty must remain visible; assistance changes evidence strength; generation is not validation; provenance and conflict must survive to the final decision.

## 5. Core / Runtime kill test

Tutor and Research did **not** expose a common deficiency requiring changes to:

- PPL Core 0.3.0
- PPL Runtime 0.1.0
- DSH Adapter 0.1.0

The new requirements were expressible as Profile-domain engines plus persisted Resolution artifacts. Core/Runtime remain frozen.

## 6. RC1 → Stable blockers

### Tutor

1. Replay at least two independent real student traces from the official corrected ASSISTments CSV or another public tutoring dataset.
2. Include a trace with hints/multiple attempts.
3. Audit chronology and duplicate handling on real ids.
4. Inspect whether the uncertainty trajectory becomes implausibly overconfident/underconfident.

### Research

1. Run at least two real research questions with source provenance.
2. Include one meaningful contradiction or inconclusive case.
3. Include at least one genuine strong validation event when claiming `ready`; otherwise Stable examples should remain `qualified`.
4. Confirm aborted evidence never enters durable ledger.

### Observatory

1. Import the resulting real `ppl.app-session/0.3` files into Observatory 0.4.
2. Human-check Tutor and Research domain tabs.
3. Preserve generic state/rule/diagnostic views for unknown future domains.

Until these are completed, 0.2.0 remains RC rather than being promoted for cosmetic completeness.

# RC2 — Real Application Gate (2026-08-19)

## Tutor: corrected ASSISTments trace exposed a real semantic defect

RC1 used a symmetric assistance penalty. This made a bottom-hint failure in the public corrected ASSISTments subset contribute only `0.045` evidence weight — the same logic used to discount assisted *success*. That is not faithful to the dataset semantics: `correct=0` records a first-attempt failure or help request, so assistance is itself evidence that the skill was not demonstrated unaided.

RC2 therefore makes evidence directional:

- success + no help → strong mastery-support;
- success + multi-attempt/hint/bottom-hint → downweighted mastery-support;
- failure/help-needed → preserved nonmastery-support;
- bottom-hint failure → preserved strongly, not erased.

Two real public corrected traces were replayed for skill `Box and Whisker`:

| user | rows | hint rows | multi-attempt failures | final mastery mean | uncertainty | evidence weight |
|---|---:|---:|---:|---:|---:|---:|
| 70363 | 6 | 1 | 2 | 0.4991 | 0.5721 | 5.22 |
| 70729 | 5 | 1 | 2 | 0.4534 | 0.5907 | 4.365 |

For user 70729, the bottom-hint failure changed from RC1 weight `0.045` to RC2 weight `0.855` and is explicitly tagged `nonmastery-support` / `bottom-hint-or-answer-reveal-needed`.

Data provenance limitation: the selected rows are from a public GitHub mirror of the corrected ASSISTments 2009–2010 Skill Builder data (`sjsarsa/kt-data-fiddler`, commit `9f653389e...`). The official ASSISTments page is the semantic authority, but this runtime did not byte-fetch the official Google Drive file. This limitation remains explicit rather than being hidden for promotion.

## Research: real scientific disagreement exposed a missing state

A second application case asked whether bilingual experience yields a replicable executive-function advantage. Five independent public studies/meta-analyses were entered with both support and opposition. The resulting evidence state was:

- support mass: `1.53`;
- oppose mass: `2.443`;
- independent source groups: `5`;
- conflict balance ratio: `0.6263`;
- strong validation: `0`.

RC1 only had `blocked / qualified / ready`, which would force a materially unresolved conflict into the wrong semantic bucket. RC2 adds first-class `inconclusive`, with next action `characterize-conflict-or-run-strong-validation`.

Final conclusion status for this case: **`inconclusive`**.

## Architecture conclusion

Neither real application defect required changes to Persona Core 0.3 or PPL Runtime 0.1. Tutor and Research needed different domain semantics, so Core/Runtime remain frozen. This is evidence that the current separation is useful; it is not a proof that future cross-domain cases cannot expose a shared lower-layer gap.

## RC3 — Broadened Real Replay + Strong Validation Boundary

### Tutor

RC3 将真实 ASSISTments replay 扩大到 56 条 corrected public-mirror rows，覆盖 7 students、4 skills，并明确包含 hint、repeated attempt 与 bottom-hint pattern。应用门禁按 user×skill 形成 11 条 trajectory，并引入最小二状态 BKT 作为 advisory sanity baseline。BKT 的角色仅是发现强反方向漂移，不用于宣称 PPL Tutor 的校准或预测性能。

RC3 Gate 结果中，PPL learner-state 与该简单 BKT 的 trace 排序保持正相关，且没有出现 all-correct 不升、all-incorrect 不降或 severe anti-direction anomaly。数值差异仍然明显，说明 PPL Tutor 当前保持更保守的 evidence-accounting 语义；这不是性能优劣结论。

### Research

RC3 暴露了 RC2 conclusion gate 的第二个语义不对称：成熟度只有 support-oriented `ready` 的直觉，而真实科研同样需要“已有足够强的反证，可报告 refutation”。因此 RC3 将：

```text
maturity: blocked | inconclusive | qualified | ready

direction: undetermined | support | oppose | mixed
```

拆成两个正交维度。

真实案例覆盖：

- GW150914 evidence → 仍 blocked；独立 GW151226 strong experiment validation → `ready + support`；
- ego-depletion 历史支持 → `qualified + support`，后续多实验/多站点强复现冲突 → `inconclusive + mixed`；
- 以反对侧 meta-analysis + 两次可重新定位的 preregistered/multisite replication 形成 `ready + oppose`，next action 为 `report-refutation`。

strong validation 只有在方法强度、reproducibility 和 re-locatable provenance 同时满足时计入 strongSupport/strongOppose。

### Architecture decision

本阶段仍未观察到 Tutor 与 Research 共享的 Host-neutral Core/Runtime 缺口。因此 Core 0.3.0、Runtime 0.1.0、DSH Adapter 0.1.0 继续冻结。RC3 的修复全部位于 Profiles domain semantics 和 Observatory projection。
