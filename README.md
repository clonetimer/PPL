# PPL — Persona Programming Language

PPL（Persona Programming Language）是一种**确定性人格 DSL 与运行时契约**，把长期行为设定从静态自然语言 Prompt 转变为：

- 可声明（declarative）
- 可编译（compilable）
- 可测试（testable）
- 可随状态变化（state-aware）
- 可解释为何变化（`why` provenance）
- 由 Host 决定何时提交 / 回滚（commit / rollback）
- 可观察历史状态（observable history）

> 目标不是“写更长的角色 Prompt”，而是让长期行为程序化、可验证、可观测。

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
  → PPL APP
```

---

## 四个稳定子产品

| 子产品 | 版本 | 职责 |
|---|---|---|
| **PPL Core** | `0.3.0` | “这个行为程序是什么意思”——lexer/parser/AST、module graph、semantic registry、静态检查、Persona IR、规则匹配、优先级、transition/commit、invariant、renderer、`why` 溯源 |
| **PPL Runtime** | `0.1.0` | “在真实会话里如何执行”——多 Snapshot、resolve 与 mutation 分离、staged state、terminal commit/rollback、JSON-safe `ppl.host-snapshot/0.1` |
| **PPL Adapter (DSH)** | `0.1.0` | 把 DeepSeek Harness 事件生命周期接入 Runtime——输入→Event、persona→system prompt、snapshot→模型上下文、completed/max-tokens→commit、aborted/error→rollback |
| **PPL APP (Persona Inspector)** | `0.1.0` | 只读观测已持久化的 Snapshot——identity/fingerprint、Turn+Step、Event、active rules、relationship、pending commit/transition、Base→Resolved、provenance/why、terminal mutation status |

### PPL Profiles（新应用主线）

`ppl_profiles_0.1.0` 是与 Core / Runtime / APP 平行的**应用主线**，把 PPL 从 Character/Role-play 扩展到学习、科研、生活服务等长期 Agent 应用。

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

四个 Reference Profiles：

| Profile | 重点状态 | 目标 |
|---|---|---|
| Character | relationship / interaction | 兼容现有人格/角色应用 |
| Tutor | mastery / misconception / confidence | 可验证学习进展 |
| Research | evidence / contradiction / provenance | 可追溯科研结论 |
| Life | preferences / plan / service boundary | 长期服务偏好与风险边界 |

Profiles 不替代 `ppl.persona-ir/0.3`，也不要求修改 PPL Core 0.3 或 Runtime 0.1。

---

## 仓库结构

```text
.
├── ppl-core-0.3.0/              # 核心编译器 / 运行时契约（Stable）
│   ├── src/                     # lexer / parser / compiler / runtime / renderer
│   ├── modules/                 # 共享语义模块（psychology, wuling）
│   ├── examples/                # 三个人格参考示例
│   └── spec/                    # grammar.ebnf + schema 定义
├── ppl-runtime-0.1.0/           # 运行时：host snapshot / projection / persona runtime
├── ppl-adapter-dsh-0.1.0/       # DeepSeek Harness Adapter
├── ppl-app-dsh-persona-inspector-0.1.0/  # 只读 Persona 观测工具
├── ppl_profiles_0.1.0/          # Profiles 应用主线（Character/Tutor/Research/Life）
├── docs/                        # 架构、使用指南、场景、路线图
├── PROMOTION_DECISION_0.1.0.md  # 版本晋升决策记录
└── STABLE_VALIDATION.json       # 稳定性验证结果
```

---

## 快速开始

### PPL Core

```bash
cd ppl-core-0.3.0
npm install
npm run build
npm test            # 21 个一致性测试 + 三个人格内嵌 source tests
```

检查 / 构建 / 渲染参考人格：

```bash
node dist/src/cli.js check examples/zhuang_fangyi/persona.ppl --module-root modules
node dist/src/cli.js build examples/zhuang_fangyi/persona.ppl \
  --module-root modules --out artifacts/zhuang_fangyi.pir.json
node dist/src/cli.js render artifacts/zhuang_fangyi.pir.json \
  --runtime examples/zhuang_fangyi/runtime.lover.json --scene PRIVATE_NIGHT
node dist/src/cli.js why examples/zhuang_fangyi/persona.ppl traits.emotional_guard \
  --module-root modules --runtime examples/zhuang_fangyi/runtime.lover.json --scene PRIVATE_NIGHT
```

CLI 子命令：`check` · `build` · `test` · `render` · `why` · `fmt`

### PPL Profiles

```bash
cd ppl_profiles_0.1.0
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

下一阶段优先推进 **APP 独立化** 与 **PPL Profiles**，而非重开 Core。

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
