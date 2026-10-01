# R2 Real Execution Integration

版本：`PPL 1.0.0-dev.3`  
状态：Development / 非 Stable

## 1. R2 解决的问题

R0/R1 已证明治理语义、独立 Vertical、持久化与统一 Gateway 可以运行，但模型、检索和 semantic Judge 仍是产品外部手工步骤。R2 将执行面正式接入产品，同时坚持：**模型只生成 candidate，Host/Governance 才拥有执行、状态和交付权。**

## 2. 新增共享执行层

`platform/execution` 提供：

- Stable Host transport resilience (`invokeWithResilience`)；
- Stable Host allowlisted `ToolExecutionLedger`；
- Stable Local Provider 的 OpenAI-compatible Chat Completions 实现桥接；
- structured JSON invocation；
- OpenAI-compatible tool continuation；
- HTTP JSON Retrieval adapter；
- SearXNG Retrieval adapter；
- deterministic scripted transport / static retrieval test doubles；
- execution run repository；
- completed tool-call ledger 的 RecordStore/SQLite 持久化；
- Agent/Research execution-run 查询；
- live endpoint environment configuration与 probe。

没有把旧 `PplLlmHostAdapter` orchestrator 直接套在新 Research Vertical 上，因为旧 Host orchestrator 与旧 Profile durable state 有自己的状态所有权。如果同时让它和 `ResearchGovernanceService` 修改状态，会形成 dual-writer。R2 只复用 Stable Host 的 transport/tool lifecycle primitives；业务状态仍由新 Vertical 单一拥有。

## 3. Generic Agent 实际执行链

```text
Agent contract + canonical context
        ↓
MAG delegation/context projection
        ↓
OpenAI-compatible model transport
        ↓
(optional) model requests tool call
        ↓
Host allowlist + argument validation + exactly-once ToolExecutionLedger
        ↓
Host sends tool result continuation
        ↓
receiver candidate claims
        ↓
MAG receiver fidelity assessment
        ↓
PASS / BLOCK
```

模型不能直接执行工具。未授权工具即使被模型请求也会被阻断。已成功写入 ledger 的 tool-call 记录可随 SQLite 跨正常进程重启保留。

R2 **不宣称**外部副作用与 ledger 写入之间的崩溃窗口已经做到原子 exactly-once；这一点需要更强的 recoverable lifecycle/checkpoint 协议。

## 4. Research 实际执行链

```text
Research question
    ↓
HTTP/SearXNG Retrieval
    ↓
Evidence Extractor model
    ↓
provisional canonical claims + Host-owned sourceRefs
    ↓
Researcher → Analyst MAG handoff
    ↓
Analyst model candidate
    ↓
MAG fidelity gate
    ↓
Analyst → Reviewer MAG handoff
    ↓
Reviewer model calibrated conclusion candidate
    ↓
MAG fidelity gate
    ↓
Delivery Evidence Binding
    ↓
Independent bound-delivery semantic Judge
    ↓
PASS: deterministic render
FAIL: block
```

Evidence extraction 的模型判定仍然不是“事实真值认证”；R2 把其状态固定为 `provisional`，并强制 sourceRef 由 Host 从 retrieval document 注入。Extractor system instruction 还明确把 retrieved document 视为**不可信数据**，禁止执行其中嵌入的 prompt/tool/role 指令。更强的来源真实性、全文解析、去重/独立性与学术检索质量属于后续 qualification。

## 5. 为什么 Research Judge 不直接使用现有 LM Studio Native Judge

`components/infrastructure/judge-lmstudio-native` 当前 Stable contract 是 Host policy classifier (`ppl.gpt-policy-judge-*`)。R2 Research 最终门使用的是 MAG 的 `ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1`，语义不同。

因此 R2 使用独立 OpenAI-compatible structured transport 承载 bound-delivery Judge，并要求/建议独立 `independenceGroup`。没有擅自扩大现有 Stable Native Judge 的 contract。

## 6. 自动资格验证

R2 自动验证分三层：

1. scripted deterministic tests：验证删除反证会被阻断；
2. localhost real HTTP protocol tests：真实走 Chat Completions / Retrieval HTTP；
3. localhost failure injection：经真实 HTTP 注入 counter-evidence erasure 与 semantic Judge reject，必须分别被 MAG / delivery gate 阻断；
4. Stable Host / Local Provider / Native Judge 回归；
5. clean offline install：删除 node_modules 和 npm cache 后仅依赖交付包重建并运行 `VERIFY_PRODUCT`。

第 2 层使用本地 mock HTTP 服务验证协议与 orchestration，不等价于真实 Qwen/LM Studio/vLLM 模型质量认证。

## 7. Live qualification

外部模型服务由部署环境提供。配置示例见 `.env.execution.example`。运行：

```bash
./RUN_R2_LIVE_PROBE.sh
```

或 Windows PowerShell：

```powershell
.\RUN_R2_LIVE_PROBE.ps1
```

只有 probe 真正连接指定模型端点并通过后，才能称该 endpoint/model 已通过本地 live connectivity/structured-output probe；本开发包本身不声明外部模型已认证。
