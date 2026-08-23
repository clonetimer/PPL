# PPL — Persona Programming Language (All Stable Source)

PPL（Persona Programming Language）是一种**确定性人格 / 长期行为 DSL 与运行时契约**，把长期行为设定从静态自然语言 Prompt 转变为：

- 可声明（declarative）
- 可编译（compilable）
- 可测试（testable）
- 可随状态变化（state-aware）
- 可解释为何变化（`why` provenance）
- 由 Host 决定何时提交 / 回滚（commit / rollback）
- 可观察历史状态（observable history）

> 目标不是“写更长的角色 Prompt”，而是让长期行为程序化、可验证、可观测。

本仓库聚合了 PPL 全部已稳定的子产品源码（截至 `2026-08-20`）。

---

## Stable 执行链

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
  → PPL APP / Observatory
```

---

## 稳定子产品（12 个）

| 子产品 | 版本 | 职责 |
|---|---|---|
| **PPL Core** | `0.3.0` | 核心编译器 / 运行时契约——lexer/parser/AST、module graph、semantic registry、静态检查、Persona IR、规则匹配、优先级、transition/commit、invariant、renderer、`why` 溯源 |
| **PPL Runtime** | `0.1.0` | 在真实会话里如何执行——多 Snapshot、resolve 与 mutation 分离、staged state、terminal commit/rollback、JSON-safe `ppl.host-snapshot/0.1` |
| **PPL DSH Adapter** | `0.1.0` | 把 DeepSeek Harness 事件生命周期接入 Runtime |
| **PPL DSH Persona Inspector** | `0.1.0` | 只读观测已持久化的 Snapshot |
| **PPL LLM Host Adapter** | `0.1.6` | 通用 LLM Host 适配层（live-gpt / rc2-live 等示例） |
| **PPL Local Provider** | `0.1.0` | 本地模型 Provider 接入 |
| **PPL LMStudio Native Judge** | `0.1.0` | LMStudio 原生评测 / Judge |
| **PPL App Observatory** | `0.5.0` | 独立化 APP——会话 / 状态 / provenance 观测台 |
| **PPL Life Binding** | `0.1.0` | 生活服务场景绑定（preferences / plan / service boundary） |
| **PPL Profiles** | `0.2.0` | 应用主线——Character / Tutor / Research / Life 四类 Reference Profile |
| **docs/** | — | 架构、使用指南、场景、路线图 |
| **STABLE_VALIDATION.json** / **PROMOTION_DECISION_*.md** | — | 稳定性验证与版本晋升记录 |

### PPL Profiles（应用主线）

`PPL_Profiles_0.2.0_Stable` 把 PPL 从 Character/Role-play 扩展到学习、科研、生活服务等长期 Agent 应用。

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

四类 Reference Profiles：

| Profile | 重点状态 | 目标 |
|---|---|---|
| Character | relationship / interaction | 兼容现有人格/角色应用 |
| Tutor | mastery / misconception / confidence | 可验证学习进展 |
| Research | evidence / contradiction / provenance | 可追溯科研结论 |
| Life | preferences / plan / service boundary | 长期服务偏好与风险边界 |

---

## 仓库结构

```text
.
├── PPL_Core_0.3.0_Stable_Source/                # 核心编译器 / 运行时契约
├── PPL_Runtime_0.1.0_Stable_Source/             # 运行时
├── PPL_DSH_Adapter_0.1.0_Stable_Source/         # DeepSeek Harness Adapter
├── PPL_DSH_Persona_Inspector_0.1.0_Stable_Source/  # 只读 Persona 观测工具
├── PPL_LLM_Host_Adapter_0.1.6_Stable_Source/    # 通用 LLM Host 适配
├── PPL_Local_Provider_0.1.0_Stable_Source/      # 本地 Provider
├── PPL_LMStudio_Native_Judge_0.1.0_Stable_Source/  # LMStudio 评测
├── PPL_App_Observatory_0.5.0_Stable_Source/     # 观测台 APP
├── PPL_Life_Binding_0.1.0_Stable_Source/        # 生活场景绑定
├── PPL_Profiles_0.2.0_Stable/                   # Profiles 应用主线
├── docs/                                        # 架构、指南、场景、路线图
├── STABLE_VALIDATION.json                       # 稳定性验证结果
└── PROMOTION_DECISION_*.md                       # 版本晋升决策记录
```

---

## 快速开始

### PPL Core

```bash
cd PPL_Core_0.3.0_Stable_Source
npm install
npm run build
npm test
```

CLI 子命令：`check` · `build` · `test` · `render` · `why` · `fmt`

### PPL Profiles

```bash
cd PPL_Profiles_0.2.0_Stable
npm test
npm run validate
npm run examples

node bin/ppl-profiles.mjs validate profiles/tutor/profile.json
node bin/ppl-profiles.mjs simulate profiles/tutor/profile.json profiles/tutor/scenarios/learning-cycle.json
node bin/ppl-profiles.mjs export-app profiles/research/profile.json profiles/research/scenarios/evidence-cycle.json > research-session.json
```

### Host 集成（PPL Core）

```ts
import { compileFile, resolve, render, applyResolution } from "./dist/src/index.js";

const compiled = compileFile("persona.ppl", { moduleRoot: "modules" });
if (!compiled.ir) throw new Error("compile failed");

const resolution = resolve(compiled.ir, runtimeState, hostContext, event);
const prompt = render(compiled.ir, resolution, "standard");
const llmResult = await callYourModel(prompt.staticPrompt, prompt.dynamicPrompt);

if (llmResult.ok && resolution.valid) {
  runtimeState = applyResolution(runtimeState, resolution);
}
```

> Host 拥有事件分类、上下文事实、模型调用，以及是否持久化 staged mutation 的最终决定权。

---

## 稳定边界（Stable Boundaries）

PPL Core `0.3` 刻意**不提供**：任意函数、循环、`eval`、网络访问、PPL 源码内文件访问、动态运行时导入、记忆数据库、概率规则、多 Agent 协调。

下一阶段优先推进 **APP 独立化**（App Observatory）、**Profiles 扩展** 与 **Host Adapter 生态**，而非重开 Core。

---

## 文档

- `docs/01_PPL_ARCHITECTURE_AND_VERSION.md` — 架构与版本说明
- `docs/02_PPL_USAGE_GUIDE.md` — 使用指南
- `docs/03_APPLICABLE_SCENARIOS.md` — 适用场景
- `docs/04_APP_INDEPENDENCE_AND_UI_REDESIGN.md` — APP 独立化与 UI 重设计
- `docs/05_PPL_PROFILES_NEW_MAINLINE.md` — Profiles 新应用主线
- `docs/06_ROADMAP_AND_ACCEPTANCE.md` — 路线图与验收标准

## License

参见各子产品 `package.json`。
