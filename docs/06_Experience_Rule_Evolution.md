# Experience Rule Evolution 0.2.0 Stable

## 目的

GEP 在 PPL 中不再被定义为“向运行时 prompt 追加一段经验文本”。当前 Stable 定位是 **Experience Distillation / Rule Evolution**。

## 生命周期

```text
Episode evidence
  → candidate rule
  → provenance validation
  → deterministic replay
  → evaluation / fault injection
  → real qualification
  → validated rule
  → enforce / observe / retire
```

## 模式

- `off`：默认，不执行 Experience Rule；
- `observe`：只记录命中；
- `evaluation`：资格环境允许 candidate rule；
- `enforce`：生产只接受 validated rule。

## 当前 validated rule

`rules/research/research-conflict-erasure-prejudge-fastpath.validated.json`

该 rule 只针对 Host 已确定的 `RESEARCH_CONFLICT_ERASURE`：已知坏稿可跳过一次冗余外部 Judge，直接进入 Host-owned repair；修复稿仍进入正常 gate，未知 policy code 仍交给 Judge。

对应 Capsule 与真实 R3 Promotion evidence 均已保留。


## 0.2.0 Stable governance update

0.2 adds unified experience evaluation, candidate lineage, multi-objective promotion, convergence tracking, rollback/restore-best governance. The runtime authority boundary remains below Host policy. The validated Tutor rule `rule_tutor_known_bad_draft_prejudge_fastpath@0.1.0` covers deterministic Tutor factual errors and forbidden final-answer leaks.
