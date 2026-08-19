# PPL Profiles 0.1.0 Stable

PPL Profiles 是与 **PPL Core / Runtime / APP** 平行的应用主线，用于把 PPL 从 Character/Role-play 扩展到学习、科研、生活服务等长期 Agent 应用。

## 定位

```text
Profile
 = Persona Binding（可选）
 + Mission
 + Interaction Protocol
 + User Model
 + Application State
 + Domain Policy
 + Capability Requirements
 + Evaluation Contract
```

Profiles **不替代** `ppl.persona-ir/0.3`，也不要求修改 PPL Core 0.3 或 Runtime 0.1。

- Persona Core/Runtime：负责人格程序与 Persona state。
- Profile Core：负责应用领域的 machine-readable state、确定性规则、commit/rollback 与 evaluation。
- Host：仍拥有真实工具、实时事实、权限与模型调用。
- Observatory：同时观察 Persona Snapshot 和 Profile Snapshot。

## Stable 契约

- Profile manifest：`ppl.profile/0.1`
- Profile resolution：`ppl.profile-resolution/0.1`
- Profile snapshot：`ppl.profile-snapshot/0.1`
- Observatory export：`ppl.app-session/0.2`

## 四个 Reference Profiles

| Profile | 重点状态 | 目标 |
|---|---|---|
| Character | relationship / interaction | 兼容现有人格/角色应用 |
| Tutor | mastery / misconception / confidence / frustration / difficulty | 可验证学习进展 |
| Research | evidence / contradiction / uncertainty / provenance | 可追溯科研结论 |
| Life | preferences / plan / service boundary | 长期服务偏好与风险边界 |

## 快速运行

无需第三方依赖：

```bash
npm test
npm run validate
npm run examples
```

验证单个 Profile：

```bash
node bin/ppl-profiles.mjs validate profiles/tutor/profile.json
```

运行 Tutor 场景：

```bash
node bin/ppl-profiles.mjs simulate \
  profiles/tutor/profile.json \
  profiles/tutor/scenarios/learning-cycle.json
```

导出给 PPL Observatory：

```bash
node bin/ppl-profiles.mjs export-app \
  profiles/research/profile.json \
  profiles/research/scenarios/evidence-cycle.json \
  > research-session.json
```

## Transaction 语义

Profile resolver 是 `Resolve != Mutation`：

1. `resolveProfileEvent()` 只产生 staged `resolvedState`；
2. `finalizeProfileResolution()` 根据 Profile 的 `transactionPolicy.commitEndReasons` 决定是否持久化；
3. Stable reference policy：`completed`、`max-tokens` 提交，`aborted/error/...` 回滚。

Profile Rule 的 `priority` **仅属于 PPL Profiles 应用层的确定性规则排序**，不改变 PPL Core 0.3 的 Persona rule/source-order 契约。

## 不是 Prompt Template Library

0.1.0 Stable 的每个 Profile 都必须具备：

- machine-readable state schema；
- 跨 Turn 状态演化；
- staged resolution；
- commit/rollback；
- deterministic rule tests；
- evaluator；
- Observatory metrics。

因此 Profiles 的完成标准不是“写更多自然语言系统提示词”。
