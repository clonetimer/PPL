# Tutor Application Evolution — 0.2.0 Stable

## 目标

从“掌握度是一个确定数字”推进到“学习证据 → 不确定知识状态 → 干预策略 → 后续 verifier → 下一轮策略”的长期闭环。

## 状态分层

### Knowledge state

每个 skill 保存：

- `alpha / beta`
- `mean`
- `variance / posteriorStd / uncertainty`
- `evidenceWeight`
- direct / assisted assessment counts
- last evidence id

### Misconception state

每个 misconception 保存：

- support
- contradiction
- confidence
- candidate / active / resolved
- evidence ids

### Pedagogy state

- recommended mode
- hint level
- recommended difficulty
- intervention ledger
- turn verifier statistics

### Affect state

Affect 不从 correct/incorrect 自动推断。只有显式 observation 且 observer confidence 达到门槛才能进入 durable state。

## Evidence Validity

正确并不等价于强 mastery evidence。Reference policy 对以下条件降低证据权重：

- 多次尝试；
- 使用 hint；
- 已揭示答案；
- scaffolding/non-original row；
- source reliability 较低。

## ASSISTments Adapter Boundary

Adapter 使用官方文档公开的 row-level 字段语义。它不会重建数据中没有保存的 action-level hint sequence。

仓库 fixture 仅验证 schema mapping；真实应用验证应使用官方下载的 corrected collapsed CSV，并先通过 `inspect-assistments` 选择一个足够长、可审计的 student/skill trace。

## RC → Stable 门槛

- 至少两条独立真实 student trace；
- 至少一条包含 hint/multi-attempt 的 trace；
- 验证 chronological ordering；
- 验证 duplicate evidence idempotence；
- 验证 aborted turn rollback；
- 检查 posterior 轨迹是否出现明显过度确定；
- 不以预测 AUC 等模型指标冒充本 Profile 的状态校准证据；如果要宣称 KT 性能，必须另建 benchmark。

## RC3 实际 replay 宽度

- 56 real corrected-mirror rows
- 7 students
- 4 skills
- 11 user×skill trajectories
- 10 hinted rows
- 17 repeated-attempt rows
- 7 bottom-hint rows

新增 BKT sanity reference 只做方向性审计。它不得被解释为 PPL Tutor 已达到 BKT calibration/accuracy，也不得为了贴合 BKT 而删除 hint/provenance/uncertainty 语义。
