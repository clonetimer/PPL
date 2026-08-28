# LM Studio 与其他 Harness

## 已验证的 Application 组合

真实 S1.12/R3 资格运行使用过以下职责拆分：

```text
Agent: OpenAI-compatible chat transport
Judge: LM Studio native /api/v1/chat, reasoning=off
```

历史真实资格中使用过 `qwen3.5-0.8b` 作为 Agent、`qwen/qwen3.5-9b` 作为独立 Judge，并验证了至少 8192 context 的运行配置。这里记录的是 qualification evidence，不把具体模型强制写成产品依赖。

## 为什么 Judge 使用 native transport

LM Studio Native Judge Transport 0.1.0 支持显式 non-thinking evaluation；这避免 Judge 把结构化输出预算全部消耗在 reasoning channel。Judge transport 只负责评估，不拥有 Host/Profile state。

## 其他 Harness

Host/Provider 的边界是可替换 transport。接入 Ollama、vLLM、llama.cpp 或自定义 Harness 时，应保持：

- Profile/Host authority 不下沉到 transport；
- structured response / tools / continuation 合同不丢失；
- Judge 与 Agent 可独立；
- durable mutation 在 delivery/authorization 后提交；
- 新 transport 必须重新做其自身 qualification，不能把 LM Studio 的证据直接转移过去。
