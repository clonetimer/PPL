# PPL Profile Specification 0.2 — Stable

## 1. 目的与兼容性

`ppl.profile/0.2` 是 PPL Profiles 的应用层契约。它不替代 `ppl.persona-ir/0.3`，也不修改 PPL Core / Runtime 的 Persona 语义。

0.2 Runtime 继续接受 `ppl.profile/0.1`，因此 Character / Life 0.1 Profile 可以和 Tutor / Research 0.2 Profile 在同一个 Runtime 中运行。

当前输出契约：

- Resolution：`ppl.profile-resolution/0.2`
- Snapshot：`ppl.profile-snapshot/0.2`
- Evaluation：`ppl.profile-evaluation/0.2`
- Observatory Session：`ppl.app-session/0.3`

## 2. Profile Manifest

必须字段：

- `schema / id / version / kind`
- `mission`
- `initialState / stateSchema`
- `rules`
- `transactionPolicy`
- `evaluation`
- `observability`

0.2 新增/正式化的可选字段：

- `engine`：声明领域解析器，例如 `tutor/uncertainty-verifier`；
- `application`：应用域与 Host ownership；
- `literature`：机制借鉴元数据，不作为运行时真值来源；
- `tutorModel / researchModel`：领域策略参数。

`personaBinding` 仍然可选。Tutor/Research Profile 不要求角色人格才能工作。

## 3. State Ownership

Profile state 只保存需要跨 Turn 持久化、且能由事件证据支持的应用状态。

默认不属于 Profile durable state：

- 实时天气、价格、位置；
- Host 权限；
- 工具结果的权威真实性；
- transcript 本体；
- Persona Runtime 已拥有的人格内部状态；
- 未经观察支持的用户情绪/意图猜测。

## 4. Generic Rule Core

0.2 保留 0.1 的条件和 effect：

Condition：`all / any / not`；source=`state/event/context`；op=`eq/neq/gt/gte/lt/lte/in/contains/exists`。

Effect：`set / add / multiply / min / max / appendUnique / removeValue / remove`。

Profiles 应用规则按 `priority` 降序；同优先级保持 manifest source order；后续规则读取 staged state。**此 priority 只属于 Profiles，不改变 Persona Core 0.3 契约。**

## 5. Resolve != Mutation

`resolveProfileEvent*()` 只返回 staged resolution：

```text
baseState + event + context
        ↓ resolve
ppl.profile-resolution/0.2
        ↓ finalize(endReason)
durable commit OR rollback
```

`completed / max-tokens` 是否提交由 `transactionPolicy.commitEndReasons` 决定。`aborted/error/...` 默认不提交。

## 6. Resolution 0.2

Resolution 必须保留：

- `baseState / resolvedState`
- `activeRules`
- path-level `mutations`
- `trace`
- `diagnostics`
- `artifacts`
- `evaluation`
- `valid`

`artifacts` 是 0.2 的重要扩展：领域引擎可以记录 evidence、intervention、verifier、claim、validation、decision 等结构化证据，而不污染通用 State Schema。

## 7. Tutor Domain Engine

Reference Engine：`tutor/uncertainty-verifier@0.2`。

### 7.1 Learner Observation

`LEARNER_OBSERVATION` 必须有稳定 `evidenceId`，并提供 `score` 或 `correct`。重复 evidenceId 不重复计权。

Reference learner model 使用透明 Beta posterior 作为**工程基线**，同时保存 mean 与 posterior spread/uncertainty；它不是对任何特定 KT 论文模型的复现或性能声明。

Assessment evidence 采用**方向非对称**计权：attempt、hint、answer revealed 和 source reliability 都进入 evidence accounting；assistance 会显著削弱“成功=已掌握”的正证据，但 `correct=0` / 首答错误 / 求助本身仍是“尚未独立掌握”的负证据，不能被同一 assistance penalty 对称抹除。

### 7.2 Misconception Evidence

错误概念以 `support / contradiction / confidence / status` 累积，不允许一次错误直接建立、一次正确直接清除。

### 7.3 Affect Gate

只有显式 `AFFECT_OBSERVED` 且 observer confidence 达到门槛才能更新长期 affect state。答错本身不得被当成“挫败”等情绪证据。

### 7.4 Intervention + Verifier

`INTERVENTION_APPLIED` 写入干预 ledger；`TURN_VERIFIED` 独立记录干预后 outcome。Learner-state estimation 和 teaching-effect verification 是两个不同层。

### 7.5 ASSISTments Adapter

Adapter 保留 documented `user_id / order_id / problem_id / skill / correct / original / attempt_count / hint_count / first_action / bottom_hint` 等 provenance，并支持：

- dataset inspection；
- user/skill selection；
- `order_id` chronology；
- max row limit；
- original-only filter。

它不会伪造数据中不存在的 action-level hint sequence。

### 7.6 BKT Sanity Reference

`@ppl/profile-tutor/bkt` 提供最小二状态 BKT reference，只用于检查 PPL Tutor trajectory 是否出现明显方向性反转、全对不升/全错不降或强反相关。**它不是 calibration target，也不构成 PPL Tutor 的 KT 性能声明。**

## 8. Research Domain Engine

Reference Engine：`research/evidence-ledger@0.2`。

### 8.1 Claim Lifecycle

`CLAIM_PROPOSED` 只产生 `proposed` claim，不等于 truth。

### 8.2 Evidence Ledger

`EVIDENCE_RECORDED` 必须有稳定 `evidenceId`；support / oppose / neutral 分开累计。来源按 independence group 处理；重复/相关来源不能被伪装成多个独立证据。

Evidence 必须保留可定位 provenance；缺失 provenance 会阻断 ready conclusion。

### 8.3 Validation Lifecycle

`VALIDATION_RESULT` 与 evidence generation 分离，有独立 validation ledger；支持 support / oppose / inconclusive、confidence 与 reproducibility。能够影响 `ready` 的 strong validation 还必须属于 replication / experiment / formal-check 等强方法、可重复，并携带可重新定位的 provenance。

### 8.4 Conclusion Gate

`CONCLUSION_REQUESTED` 先确定**成熟度 status**，再独立确定**方向 direction**。成熟度根据 dominant evidence mass、独立来源、counter-evidence、provenance、strong validation 和 uncertainty 产生：

- `blocked`：证据/来源/验证门禁尚未满足；
- `inconclusive`：支持与反对均达到实质规模且较均衡，冲突尚未解决；
- `qualified`：证据方向足以支持带限定条件报告，但仍存在 caveat/弱验证/残余冲突；
- `ready`：dominant direction 满足强验证等更严格门禁。

方向取值：`support / oppose / mixed / undetermined`。因此 `ready + support` 与 `ready + oppose` 都合法；后者表示“反驳该 claim 的结论已经满足报告门禁”。`inconclusive + mixed` 表示实质冲突仍未解决。

`ready` 只表示**满足此 Profile 的报告门禁**，不表示客观科学真理已经证明。

## 9. Snapshot / Observatory

`ppl.profile-snapshot/0.2` 在 0.1 基础上正式携带 `profile.engine` 与 Resolution artifacts。`ppl.app-session/0.3` 增加 `domain` 和 `literature` 元数据，使 Observatory 可以提供 Tutor / Research 领域视图，同时仍保留通用 Snapshot/Rule/Mutation 视图。

## 10. Promotion Boundary

0.2.0 Stable 已满足下列软件 promotion gate，但不得因此自称领域模型已完成统计校准。Stable promotion 证据包括：

1. Tutor：**官方来源或可核验公开镜像**的真实学习交互 CSV 独立 trace 重放；若不是官方原始字节，应在证据报告中明确 provenance 限制；
2. Research：至少一套带真实 provenance 的研究问题/evidence/validation 流程；
3. 两者都验证 rollback、dedup、uncertainty/conflict preservation；
4. Observatory 对 0.3 Session 的领域视图可用；
5. 不因这些应用缺口修改 Core/Runtime，除非出现跨 Tutor/Research 共性的底层表达缺口。
