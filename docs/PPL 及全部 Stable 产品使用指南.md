# PPL 及全部 Stable 产品使用指南

## 1. PPL 是什么

当前 PPL 不是一个单独可执行程序，而是一组分层产品：

```text
PPL Core            → 定义/编译 Persona 语义
PPL Runtime         → Host-neutral resolve/snapshot/transaction
PPL Profiles        → Tutor/Research/Life/Character 应用状态与行为语义
PPL Host            → 真实 LLM Agent / tools / Judge / delivery / commit
Provider/Transport  → 对接 LM Studio / OpenAI-compatible server / 其他 Harness
Observatory         → 只读 Session / Profile / Evidence / lifecycle UI
Host Bindings       → 将特定领域（如 Life）的 Host authority 变成严格生成合同
```

推荐开发原则：Profile/Host/Provider 各自负责自己的边界；模型输出始终是 untrusted candidate，不能直接写 durable state。

---

# 2. PPL Core 0.3.0

## 用途

- 编写 `.ppl` Persona；
- 语法/引用检查；
- deterministic Persona tests；
- 编译为 `ppl.persona-ir/0.3`；
- render 为 LLM prompt。

## 快速使用

源码目录中：

```bash
npm install
npm test
```

常见命令：

```bash
ppl check persona.ppl
ppl test persona.ppl
ppl render persona.ppl --profile standard
```

生产推荐边界：先 build 一次 PIR：

```bash
ppl build persona.ppl --module-root modules --out persona.pir.json
ppl render persona.pir.json --runtime runtime.json --context context.json
```

典型循环：

```text
source → compile → Persona IR       （启动/发布阶段）
Runtime + Context + Event
      → resolve → render → LLM      （每 turn）
      → success 后 commit
```

---

# 3. PPL Runtime 0.1.0

## 用途

Runtime 不负责模型调用。它负责把 PPL Persona IR 接到 Host session：

- Persona runtime state；
- Host snapshot；
- projection；
- staged resolution 与 commit/rollback。

主要 exports：

```js
import * as pplRuntime from '@ppl/runtime'
```

产品原则：

```text
Resolve != Mutation
```

Host/LLM 调用失败、abort 或被 block 时，不应把 pending mutation 当作已提交状态。

---

# 4. PPL DSH Adapter 0.1.0

仅在使用 DeepSeek Harness 时使用。

核心行为：

- DSH session-start 时注册 static persona section；
- pre-step 时从 DSH events 计算 PPL dynamic projection；
- 生成 `source.ppl` snapshot metadata；
- 不把 APP UI 逻辑混入 prompt projection。

使用方式优先走 `deployment/deepseek-harness/ppl-stable-clean-dsh-kit-2026-08-19.zip`，不要手工复制 adapter 文件到未知 DSH 版本。

---

# 5. DSH Persona Inspector 0.1.0（兼容/历史 Stable）

只读 UI：

- Persona identity/fingerprint；
- Turn/Step；
- Event；
- active rules；
- relationship state；
- pending commit/transition；
- resolution provenance。

它**不贡献 prompt**，也不重新 resolve history。

新项目优先使用 Observatory 0.5。

---

# 6. PPL Profiles 0.2.0

## Profile 组成

```text
profiles/character/profile.json
profiles/tutor/profile.json
profiles/research/profile.json
profiles/life/profile.json
```

0.2 的主要 Reference Engines 是 Tutor / Research；Character / Life manifest 继续保持兼容 Profile 形态，Life 的真实 LLM Host 约束由 `@ppl/host-binding-life` 提供。

## 安装/验证

```bash
npm install
npm test
npm run validate
npm run examples
npm run application-gate
```

## Tutor 模拟

```bash
node bin/ppl-profiles.mjs simulate \
  profiles/tutor/profile.json \
  profiles/tutor/scenarios/application-cycle.json
```

Tutor 0.2 关注：

- mastery mean + uncertainty；
- hint / answer-revealed 等 assessment validity；
- misconception evidence；
- independent affect observation；
- intervention ledger；
- verifier 与 learner-state estimation 分离。

不要把 Tutor 的 mastery mean 当成未经校准即可解释的真实概率。

## Research 模拟

```bash
node bin/ppl-profiles.mjs simulate \
  profiles/research/profile.json \
  profiles/research/scenarios/application-cycle.json
```

Research 0.2 关注：

- claim lifecycle；
- evidence idempotence；
- support / oppose / neutral；
- independent/correlated source；
- validation ledger；
- reproducibility；
- `blocked / inconclusive / qualified / ready` maturity；
- `support / oppose / mixed / undetermined` direction。

`ready` 只表示满足 Profile 门禁，不等于科学真理。

## 导出 Observatory

```bash
node bin/ppl-profiles.mjs export-app \
  profiles/research/profile.json \
  profiles/research/scenarios/application-cycle.json \
  > research.app-session.json
```

---

# 7. PPL LLM Host Adapter 0.1.6

这是当前真实 Agent Application Stack 的核心 Host。

## 核心 Authority

```text
Profile → durable state / policy / evidence semantics
Agent   → 用户可见候选行为与 proposal
Judge   → 受限分类，不拥有 durable state
Host    → facts / tools / provenance / delivery / transaction
```

Agent 不得直接 patch mastery、Evidence Ledger、conclusion state 或其他 durable Profile state。

## 创建 Host

```js
import {
  createCallbackTransport,
  createPplLlmHostAdapter,
} from 'ppl-llm-host-adapter'

const agentTransport = createCallbackTransport({
  identity: { provider:'my-provider', model:'agent-model', independenceGroup:'agent-A' },
  invoke: async (request, context) => {
    // 调用真实模型；返回最终 structured candidate
  },
})

const judgeTransport = createCallbackTransport({
  identity: { provider:'other-provider', model:'judge-model', independenceGroup:'judge-B' },
  invoke: async (request, context) => {
    // Restricted Judge
  },
})

const host = createPplLlmHostAdapter({
  agentTransport,
  judgeTransport,
  independenceMode: 'required',
})
```

## Transaction rule

```text
Profile state
→ request
→ transport completed
→ response contract valid
→ Judge deliver
→ Session write slot
→ deterministic mutation
```

以下情况都不得 durable mutate：

```text
partial stream
network failure
timeout
cancel
Judge review
Judge block
invalid response contract
```

## Tool lifecycle

```text
model proposal
→ Host allowlist
→ args schema
→ ToolExecutionLedger
→ Host execution
→ provenance-locked result
```

同一 callId + 相同参数必须 exactly-once/replay；callId 相同但参数变化必须拒绝。

## Recoverable lifecycle

Host 0.1.6 提供：

```js
PplLlmHostAdapter.runRecoverableToolMediatedAgentTurn(...)
```

以及 `./recoverable-lifecycle` 导出的 standalone lifecycle/helper，用于将 tool proposal、durable ledger、crash/restart、continuation、Judge、delivery、commit 形成一个可恢复 turn。

---

# 8. Local OpenAI-compatible Provider 0.1.0

## Presets

```text
minimal
lmstudio
ollama
vllm
llama.cpp
```

查看 preset：

```js
import {
  listLocalProviderPresets,
  localProviderPreset,
} from '@ppl/provider-openai-compatible-local'

console.log(listLocalProviderPresets())
console.log(localProviderPreset('lmstudio'))
```

创建 LM Studio transport：

```js
import { createOpenAICompatibleChatTransport } from '@ppl/provider-openai-compatible-local'

const transport = createOpenAICompatibleChatTransport({
  preset: 'lmstudio',
  model: 'qwen3.5-0.8b',
})
```

Provider 会按 capability contract 判断：

- structured output；
- tool calling；
- tool-choice control；
- parallel-tool control；
- strict tool schema；
- reasoning effort。

“OpenAI compatible”不是一个二值能力；不要假定所有 backend 对可选字段完全一致。

## 模型发现

```js
import {
  discoverVisibleModels,
  resolveVisibleModel,
} from '@ppl/provider-openai-compatible-local'
```

LM Studio 路径应优先使用 `/v1/models` 返回的真实模型 ID。

---

# 9. LM Studio Native Judge Transport 0.1.0

创建：

```js
import { createLmStudioNativeJudgeTransport } from '@ppl/lmstudio-native-judge-transport'

const judge = createLmStudioNativeJudgeTransport({
  model: 'qwen/qwen3.5-9b',
  endpoint: 'http://127.0.0.1:1234/api/v1/chat',
  reasoning: 'off',
  temperature: 0,
})
```

该 transport 会要求模型仅做 restricted policy classification。它不拥有：

- severity；
- Profile policy；
- durable state；
- tool authority；
- delivery decision 的最终所有权。

这些仍由 Host 负责。

---

# 10. Life Host Binding 0.1.0

Life Binding 将 Host 风险判断、实时事实和用户 mutation authorization 前置成严格模型合同。

主要 API：

```js
import {
  compileLifeHostRequest,
  validateLifeHostResponse,
  applyLifeModelResponse,
  applyLifeHostRisk,
  observeLifeRealtimeFact,
} from '@ppl/host-binding-life'
```

基本流程：

```text
Host realtimeFacts + hostRisk + mutationAuthorization
        ↓
compileLifeHostRequest
        ↓
LLM candidate
        ↓
validateLifeHostResponse
        ↓
applyLifeModelResponse（只有合法、被授权的 proposal 才可能变成 Profile event）
```

关键约束：

- realtime fact citation 只能使用 Host 给出的精确 locator；
- 没有 realtime fact 时 citations 必须为空；
- high-risk 本轮只允许 `life-escalation`；
- 未授权时不能提出 preference/plan mutation；
- 历史 escalation 状态不能覆盖本轮 `hostRisk`。

---

# 11. Observatory 0.5

## APP 能看什么

- Persona/Profile snapshots；
- Tutor learning state；
- Research evidence/conflict/validation；
- Life durable state；
- Agent/Judge turn audit；
- tool executions；
- restart markers；
- recoverable-turn checkpoints。

Observatory 是**只读观察器**，不会重新 resolve 或修改 Host/Profile。

Standalone 运行见：

```text
deployment/PPL_OBSERVATORY_STANDALONE_DEPLOYMENT.md
```

DSH export 投影见：

```text
deployment/deepseek-harness/PPL_DEEPSEEK_HARNESS_DEPLOYMENT.md
```

---

# 12. 推荐产品组合

## A. Persona / 角色卡

```text
Core 0.3
+ Runtime 0.1（需要持续状态时）
+ Observatory 0.5（可选）
```

## B. Tutor

```text
Profiles 0.2 Tutor
+ Host 0.1.6
+ Agent Provider
+ Independent Judge
+ Observatory 0.5
```

## C. Research

```text
Profiles 0.2 Research
+ Host 0.1.6
+ Agent Provider
+ tools / evidence materialization
+ Independent Judge
+ Observatory 0.5
```

## D. Life

```text
Profiles 0.2 Life manifest
+ Life Binding 0.1.0 Stable
+ Host 0.1.6
+ Agent Provider
+ authoritative realtime/risk layer
+ Observatory 0.5
```

## E. DeepSeek Harness Persona integration

```text
Core 0.3
+ Runtime 0.1
+ DSH Adapter 0.1
+ optional legacy Persona Inspector
+ optional standalone Observatory 0.5 via DSH export projection
```
