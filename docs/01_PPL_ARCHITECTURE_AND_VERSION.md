# PPL 架构与稳定版本说明

## 1. PPL 的核心目的

PPL（Persona Programming Language）的目标不是“写更长的角色 Prompt”，而是把长期行为设定从静态自然语言变成：

- 可声明；
- 可编译；
- 可测试；
- 可随状态变化；
- 可解释为什么发生变化；
- 可由 Host 决定何时提交/回滚；
- 可观察历史状态。

稳定执行链：

```text
.ppl source
  → PPL Core compile
  → ppl.persona-ir/0.3
  → Runtime + Host Context + Event
  → deterministic resolve
  → pending commit / transition
  → Host model call / interaction
  → commit or rollback
  → ppl.host-snapshot/0.1
  → PPL APP
```

## 2. 四个稳定子产品

### PPL Core 0.3.0

负责“这个行为程序是什么意思”。包含 lexer/parser/AST、module graph、semantic registry、静态检查、Persona IR、frozen rule matching、priority buckets、transition、commit、invariant、renderer、source tests 与 `why` provenance。

**冻结边界**：没有真实 Core 级缺口，不启动 0.4。

### PPL Runtime 0.1.0

负责“在真实会话里如何执行”。它不拥有 Host 业务事实，也不决定自然语言是什么 Event。

稳定语义：

- `(turn, step)` 多 Snapshot；
- resolve 与 mutation 分离；
- 同一 Turn 内 staged state；
- terminal commit / rollback；
- JSON-safe `ppl.host-snapshot/0.1`；
- `ppl.host-resolution/0.1`。

### PPL Adapter — DeepSeek Harness 0.1.0

负责把 DSH 的事件生命周期接到 Runtime：

- 人类输入 → Event adapter；
- static persona → DSH system prompt；
- dynamic snapshot → current model context；
- DSH `completed` / `max-tokens` → commit；
- aborted/error 等 → rollback。

这是 Host Adapter，不是 PPL 核心语义。

### PPL APP — Persona Inspector 0.1.0

负责观察已经持久化的 Snapshot：

- Persona identity / fingerprint；
- Turn + Step；
- Event；
- active rules；
- relationship；
- pending commit / transition；
- Base → Resolved；
- provenance / why；
- terminal mutation status。

它是只读工具，历史浏览不应重新运行 Event classification 或 PPL resolve，也不贡献 Prompt。

## 3. 当前已知结构性缺口

当前最大的结构性缺口不是 Core/Runtime，而是 APP：

1. Stable APP 仍是 DSH workspace plugin，源码可拿出来，但编译/部署依赖 DSH workspace peer dependencies。
2. UI 以开发调试为主，信息密度高、英文标签多、视觉层级不足。
3. 只有 Snapshot 级观测，缺少 Session 级趋势、Rule 统计、跨 Turn 因果链。
4. “Character Persona”概念占据 UI 中心，不足以覆盖 Tutor / Researcher / Life Assistant 等非娱乐 Profile。

因此下一阶段优先推进 APP 独立化和 `PPL Profiles`，而不是重开 Core。
