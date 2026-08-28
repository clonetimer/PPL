# Research Application Evolution — 0.2.0 Stable

## 目标

从“检索并总结”推进到可审计的：

```text
Question
→ Claim / Hypothesis
→ Evidence Ledger
→ Conflict / Independence
→ Validation
→ Conclusion Gate
```

## Claim 不是 Truth

新 claim 默认 `proposed`，没有 evidence/validation 时结论必须 blocked。

## Evidence Ledger

Evidence 保存：

- stable evidence id；
- claim id；
- support / oppose / neutral stance；
- source provenance；
- quality weight；
- independence group；
- provenance completeness。

同一 evidence id 不重复计权；同一 independence group 的重复来源按相关性系数降权。

## Conflict Preservation

support 与 oppose 分开记账。存在显著 opposition 时，即使支持充分，也只能进入 `qualified` 或继续 blocked，不能通过单一平均 confidence 抹平冲突。

## Validation Lifecycle

Validation 独立保存：

- method；
- support / oppose / inconclusive；
- confidence；
- reproducible；
- artifact。

生成 hypothesis 本身不能算作 validation。

## Conclusion Gate

Reference gate 组合：

- support mass；
- independent support groups；
- opposition mass；
- provenance completeness；
- validation attempts；
- reproducibility；
- uncertainty。

输出：`blocked / inconclusive / qualified / ready`。

`ready` 的语义是“可在保留 provenance 的情况下按此 Profile policy 报告”，不是“已证明为科学真理”。

## RC → Stable 门槛

- 至少两个真实研究问题；
- 每个问题至少三条可定位来源；
- 至少一次显式 validation；
- 至少一个冲突或 inconclusive case；
- 验证 correlated-source downweight；
- 验证 incomplete provenance 阻断；
- 验证 aborted evidence 不进入 durable ledger；
- Observatory 能同时显示 generic causality 与 Research domain ledger。

## RC3：成熟度与方向分离

Research conclusion 现在由两个正交字段构成：

- `conclusionStatus`: blocked / inconclusive / qualified / ready
- `conclusionDirection`: undetermined / support / oppose / mixed

这使强支持与强反驳都可以达到 ready，而相互冲突的 strong replications 仍可保持 inconclusive/mixed。strong validation 还要求 re-locatable provenance，避免仅凭“某项实验据称可重复”进入 ready。
