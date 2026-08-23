# PPL 其他基座 / Harness 部署指南

本指南覆盖**不依赖 DeepSeek Harness checkout**的 PPL Application Host 部署。优先路径是当前已经真实认证的 Windows + LM Studio；也给出 Ollama、vLLM、llama.cpp 和任意自定义 Harness 的接入边界。

---

## 1. 推荐 Stable Application Stack

```text
PPL Profiles 0.2
       ↓
PPL LLM Host Adapter 0.1.6
       ├─ Agent Transport
       ├─ ToolExecutionLedger / Recoverable Turn Store
       ├─ Independent Judge
       └─ delivery-before-commit
       ↓
Profile durable state
       ↓
Observatory 0.5（可选 UI）
```

可安装包位于 Release Kit 的 `packages/`。

创建空 Node 项目后，可离线安装：

```bash
npm init -y
npm install --offline \
  /path/to/packages/ppl-llm-host-adapter-0.1.6.tgz \
  /path/to/packages/ppl-provider-openai-compatible-local-0.1.0.tgz \
  /path/to/packages/ppl-lmstudio-native-judge-transport-0.1.0.tgz \
  /path/to/packages/ppl-host-binding-life-0.1.0.tgz
```

Host 0.1.6 npm bundle 已包含所需 Profile 0.2 runtime packages。若你要直接开发/模拟 Profiles，也可以另行安装 `ppl-profile-*.tgz`。

---

## 2. Windows + LM Studio：当前首选、live-certified

### 2.1 服务器

LM Studio 当前 OpenAI-compatible base URL 默认示例是：

```text
http://localhost:1234/v1
```

PPL Local Provider 的 Stable LM Studio preset 使用：

```text
http://127.0.0.1:1234/v1/chat/completions
```

Native Judge 使用：

```text
http://127.0.0.1:1234/api/v1/chat
```

推荐实际已验证分工：

```text
Qwen3.5-0.8B → Agent / structured response / tools / continuation
Qwen3.5-9B   → Independent Judge, reasoning=off
```

LM Studio 中在 Developer 页面启动 Local Server，并确保所需模型可见/已加载。若启用 API token，在本地进程中设置 token；不要把 token 写进 PPL Profile 或 session evidence。

### 2.2 Agent Transport

```js
import { createOpenAICompatibleChatTransport } from '@ppl/provider-openai-compatible-local'

const agentTransport = createOpenAICompatibleChatTransport({
  preset: 'lmstudio',
  model: 'qwen3.5-0.8b',
  endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
  maxOutputTokens: 768,
  temperature: 0,
})
```

模型 ID 不应凭空猜测。Provider 提供 `/v1/models` discovery，可使用 server 实际返回的 ID。

### 2.3 Independent Judge

```js
import { createLmStudioNativeJudgeTransport } from '@ppl/lmstudio-native-judge-transport'

const judgeTransport = createLmStudioNativeJudgeTransport({
  model: 'qwen/qwen3.5-9b',
  endpoint: 'http://127.0.0.1:1234/api/v1/chat',
  reasoning: 'off',
  temperature: 0,
})
```

Native Judge 只是 transport。Policy taxonomy、severity、response-contract validation、deliver/review/block 仍由 Host 所有。

### 2.4 创建 Host

```js
import { createPplLlmHostAdapter } from 'ppl-llm-host-adapter'

const host = createPplLlmHostAdapter({
  agentTransport,
  judgeTransport,
  independenceMode: 'required',
})
```

`required` 要求 Agent/Judge 的 `independenceGroup` 不同，否则 fail closed。

---

## 3. Ollama

PPL Local Provider Stable 有 `ollama` preset：

```js
const agentTransport = createOpenAICompatibleChatTransport({
  preset: 'ollama',
  model: '<ollama-model-name>',
})
```

默认 PPL endpoint：

```text
http://127.0.0.1:11434/v1/chat/completions
```

PPL 对 Ollama 的状态是 **protocol/conformance-qualified，不是本项目 live-certified backend**。正式上线前必须用你的具体模型验证：

- JSON Schema structured output；
- tool calling；
- streaming；
- tool continuation；
- 模型输出质量。

Ollama 当前官方文档说明其支持 structured outputs、tool calling，并提供 OpenAI compatibility；但具体模型是否稳定满足 PPL 合同仍是经验性 Gate。

---

## 4. vLLM

PPL preset：

```js
const agentTransport = createOpenAICompatibleChatTransport({
  preset: 'vllm',
  model: '<served-model-id>',
  endpoint: 'http://127.0.0.1:8000/v1/chat/completions',
})
```

vLLM 的 tool calling 能力依赖启动时的模型、chat template、tool parser / structured-output 配置。不要只因为 endpoint 返回 200 就认为 tool contract 已合格。

例如部署前至少验证：

```text
structured JSON
named/required/auto tool behavior
parallel tool policy
stream finalization
Host continuation
```

PPL preset 对 vLLM 声明较多能力，但仍需对实际 server launch config 做 certification。

---

## 5. llama.cpp

PPL preset：

```js
const agentTransport = createOpenAICompatibleChatTransport({
  preset: 'llama.cpp',
  model: '<server-model-id>',
  endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
})
```

llama.cpp 当前 server 提供 OpenAI-compatible chat、schema-constrained JSON 和 function/tool calling 能力；但 PPL Stable preset **刻意保持保守**，structured output 默认按 prompt-only/Host validation 处理，除非你的具体 server/model 再做能力认证。

---

## 6. 任意其他 Agent Harness：Callback Transport

如果基座不是 OpenAI-compatible HTTP server，而是某个现成 Agent/Harness SDK，PPL Host 0.1.6 的正确边界是实现一个 callback transport，而不是修改 Core/Runtime：

```js
import {
  createCallbackTransport,
  createPplLlmHostAdapter,
} from 'ppl-llm-host-adapter'

const agentTransport = createCallbackTransport({
  identity: {
    provider: 'my-harness',
    model: 'agent-model',
    independenceGroup: 'agent-A',
  },
  invoke: async (request, context) => {
    // 1. 将 PPL Host request 映射到你的 Harness。
    // 2. 收集最终结果；不要把 partial stream 写入 Profile durable state。
    // 3. 返回 PPL 所需的 structured candidate。
  },
})
```

Judge 可使用另一个 callback transport。若使用 `independenceMode:'required'`，Agent/Judge 必须来自不同 independence group。

### Harness Adapter 的职责

应该处理：

- request/response mapping；
- transport timeout/retry/abort；
- provider model identity；
- streaming finalization；
- tool proposal transport representation。

不应该处理：

- 直接 patch Profile durable state；
- 绕过 Host tool allowlist / idempotency；
- 自行改变 Policy Judge severity；
- 在 delivery gate 之前 commit mutation。

---

## 7. 可恢复 Agent Turn

Host 0.1.6 Stable 提供产品化 recoverable lifecycle。生产环境应把：

```text
Agent proposal
→ Host tool allowlist/schema
→ durable ToolExecutionLedger
→ tool continuation
→ independent Judge
→ delivery barrier
→ deterministic Profile commit
```

作为一个 lifecycle 使用，而不是应用层手工拼接后忘记某个 Gate。

对副作用工具，使用 durable ToolExecutionLedger；同一 `callId + name + args` 重试必须 replay 原结果，同一 `callId` 改参数必须拒绝。

---

## 8. 上游能力参考（2026-08-20 查验）

- LM Studio OpenAI compatibility: https://lmstudio.ai/docs/developer/openai-compat
- LM Studio native REST API: https://lmstudio.ai/docs/developer/rest
- LM Studio tool use: https://lmstudio.ai/docs/developer/openai-compat/tools
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
- Ollama structured outputs: https://docs.ollama.com/capabilities/structured-outputs
- Ollama tool calling: https://docs.ollama.com/capabilities/tool-calling
- vLLM OpenAI-compatible server: https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/
- vLLM tool calling: https://docs.vllm.ai/en/latest/features/tool_calling/
- llama.cpp server: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md

这些上游链接只用于部署能力核验；PPL Stable 资格边界以本 Release Kit 的 promotion evidence 为准。
