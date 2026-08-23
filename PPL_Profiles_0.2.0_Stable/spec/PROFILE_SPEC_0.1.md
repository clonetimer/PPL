# PPL Profile Specification 0.1

## 1. Manifest

Profile 文件必须声明：

- `schema = ppl.profile/0.1`
- `id / version / kind`
- `mission`
- `initialState`
- `stateSchema`
- `rules`
- `transactionPolicy`
- `evaluation`
- `observability`

可选声明：`personaBinding / interaction / userModel / domainPolicy / capabilities`。

## 2. State ownership

Profile state 只保存**长期应用行为状态**。以下数据默认不属于 Profile：

- 实时天气、价格、位置等实时事实；
- 工具执行结果的权威真实性判断；
- Host 权限；
- LLM transcript 本体；
- PPL Persona Runtime 已拥有的人格内部状态。

## 3. Conditions

Stable 支持：

- `all / any / not`
- source：`state / event / context`
- op：`eq / neq / gt / gte / lt / lte / in / contains / exists`

规则按 `priority` 降序执行，同优先级保持 source order。后续规则条件读取当前 staged state。

## 4. Effects

Stable 支持：

- `set`
- `add`（可 min/max clamp）
- `multiply`
- `min / max`
- `appendUnique / removeValue`
- `remove`

每个 effect 都必须产生 path-level mutation trace。

## 5. Transaction

`resolveProfileEvent()` 不修改 durable state。

`finalizeProfileResolution()` 根据 `transactionPolicy.commitEndReasons`：

- commit：durable = resolvedState；
- rollback：durable 保持 base state。

## 6. Evaluation

Stable evaluator 支持：

- `path`
- `delta`
- `equals`
- `exists`（返回字段是否存在，用于表达“错误概念已清除”等状态）
- `gte`
- `lte`

Evaluation 用于应用目标验证，不参与模型生成。

## 7. Snapshot

`ppl.profile-snapshot/0.1` 必须包含：

- profile id/kind/version/fingerprint；
- host turn/step；
- event；
- base/resolved state；
- active rules；
- mutations/trace/diagnostics/evaluation；
- transaction endReason/status。
