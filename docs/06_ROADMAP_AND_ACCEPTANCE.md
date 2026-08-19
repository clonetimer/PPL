# 下一阶段路线图与验收标准

## 主线 A — PPL APP 独立化（最高优先级）

### A1. 0.3.0-alpha — Host-neutral Observatory

目标：不用 clone DSH 即可安装/运行 APP。

任务：

- 抽 `app-core`；
- 定义 `ppl.app-session/0.1`；
- standalone file/HTTP input；
- DSH adapter 变成可选插件；
- 中文优先 UI；
- Timeline / Trend / Diff / Rule Impact / Why。

验收：

- standalone clone 仅 PPL APP 源码即可启动；
- `app-core` dependency tree 不包含 `@deepseek-ai/*`；
- 同一份 Session JSON 在 standalone 与 DSH plugin 的核心计算结果一致；
- 无历史重算。

### A2. 0.3.0-rc — Session Observatory

新增：

- 跨 Turn 数值曲线；
- Rule hit statistics；
- relationship/task state trajectory；
- causal chain；
- diagnostics dashboard；
- import/export evidence bundle。

### A3. 0.3.0 Stable

至少验证两个 Host：

- DeepSeek Harness；
- standalone JSON/HTTP Host。

## 主线 B — PPL Profiles

### B0. Spec / 0.1 alpha

- `ppl.profile/0.1`；
- Character/Tutor/Research/Life 四个 profile schema；
- reference examples；
- evaluator contract。

### B1. Tutor Profile

验收案例：

```text
learner mastery low
→ hint-first
→ assessment passed
→ mastery increases
→ next task difficulty increases
```

必须在 APP 中看到完整状态轨迹。

### B2. Research Profile

验收案例：

```text
claim
→ evidence missing
→ search/tool evidence
→ conflicting source
→ uncertainty retained
→ conclusion + provenance
```

### B3. Life Profile

验收案例：偏好/计划长期状态 + tool-owned realtime facts + 高风险边界。

## 主线 C — Core / Runtime

默认冻结。

只有以下情况才重新打开：

- Profiles 出现无法通过模块/状态/规则表达的**通用**语义缺口；
- 两个以上独立应用 Profile 重复出现同一 Core 级缺陷；
- Host-neutral Runtime contract 无法表达真实 transaction 语义。

单个 UI 或单个 Host 的问题不能触发 Core 0.4。

## 近期开发顺序

1. 完成 APP 0.3 Host-neutral 拆分。
2. 把当前 Persona Inspector 0.2 RC 的 Diff/Rule Impact 能力迁入 app-core。
3. 做 Session Overview / curves / rule statistics。
4. 同时启动 Profiles 0.1 spec。
5. 先做 Tutor Profile 真应用。
6. 再做 Research Profile。
7. 根据真实缺口决定是否需要 Runtime 0.2 / Core 0.4。
