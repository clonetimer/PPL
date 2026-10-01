# PPL 1.0 Product Refactor — 1.0.0-dev.3

> **状态：Development / 非 Stable。** 本包继续以 2026-08-27 Stable components 为冻结语义基线；R2 新增真实执行接口，但不宣称本构建环境已完成外部模型 live qualification。

PPL 1.0 当前采用 **Shared Governance/Execution Kernel + Independent Verticals + Unified Gateway**。Research、Tutor、Life、Character 的业务状态模型保持独立；共享的是 persistence、audit、transport、tool lifecycle 和 deployment surface。

## 当前产品结构

```text
platform/
  ├─ core       persistence / repositories / audit / idempotency
  └─ execution  model transport / retrieval / Host tool lifecycle / live probe

product/
  ├─ agent-governance       Generic Multi-Agent authority/fidelity + real execution
  ├─ research-governance    Retrieval→Evidence→Analyst→Reviewer→Judge→Delivery
  ├─ tutor-governance       学习者状态与教学验证
  ├─ life-governance        长期偏好/计划 + realtime/risk boundary
  ├─ character-governance   Character/NPC relationship state
  └─ platform-gateway       统一 HTTP 入口
```

## 一键安装与验证

要求 Node.js >= 22.5。产品层依赖可从本包离线安装：

```bash
./INSTALL_PRODUCT.sh
./VERIFY_PRODUCT.sh
```

Windows：

```bat
INSTALL_PRODUCT.cmd
VERIFY_PRODUCT.cmd
```

`VERIFY_PRODUCT` 包含 deterministic tests、MAG 回归与 R2 localhost HTTP end-to-end smoke。localhost mock HTTP 验证的是**真实网络协议路径**，不是外部模型质量认证。

## 启动统一 Gateway

```bash
npm start
```

默认：

- HTTP: `127.0.0.1:8787`
- SQLite: `var/ppl-product.sqlite`
- Apps: `GET /v1/apps`
- API prefixes: `/v1/agent`、`/v1/research`、`/v1/tutor`、`/v1/life`、`/v1/character`
- Generic execution: `POST /v1/agent/sessions/:id/execute`
- Research execution: `POST /v1/research/sessions/:id/execute`
- Execution history: `GET /v1/{agent|research}/sessions/:id/executions`

未配置执行环境时，治理/持久化 API 仍正常工作，`/execute` 返回 `503 EXECUTION_NOT_CONFIGURED`。

## 连接真实模型 / Retrieval

复制并按本机环境设置 `.env.execution.example` 中对应环境变量。核心配置：

```text
PPL_EXECUTION_ENABLED=1
PPL_AGENT_PRESET=vllm|lmstudio|ollama|llama.cpp|minimal
PPL_AGENT_ENDPOINT=.../v1/chat/completions
PPL_AGENT_MODEL=...
PPL_JUDGE_ENDPOINT=.../v1/chat/completions
PPL_JUDGE_MODEL=...
PPL_RETRIEVAL_KIND=http|searxng
PPL_RETRIEVAL_ENDPOINT=...
```

然后先做连通性/structured-output probe：

```bash
./RUN_R2_LIVE_PROBE.sh
```

PowerShell：

```powershell
.\RUN_R2_LIVE_PROBE.ps1
```

当前执行环境探测不到 `127.0.0.1:8000`、`8001`、`1234` 的外部模型服务，因此本包**没有**伪造 Qwen/vLLM/LM Studio live-qualified 结论。

## R2 的关键治理边界

- LLM 输出始终是 candidate；MAG fidelity gate 之后才允许继续。
- 模型只能请求 tool call；参数校验、allowlist、副作用和幂等 ledger 由 Host 拥有。已完成的 ledger 记录可随 SQLite 跨正常重启保留；R2 不宣称外部副作用与 ledger 落盘之间的崩溃窗口已经原子 exactly-once。
- Research 抽取的模型证据先标记为 `provisional`，sourceRef 由 Host 从 Retrieval 结果注入；retrieved text 被明确视为不可信数据，Extractor 不得执行其中嵌入的指令。
- Research final delivery 必须经过 MAG evidence binding + explicit semantic Judge。
- Agent / Judge 可以设置 `PPL_MODEL_INDEPENDENCE=required`，避免同一 independence group 自审。
- 现有 `LM Studio Native Judge` Stable contract 是 Host policy Judge；R2 不擅自把它当成 MAG bound-delivery Judge。

下一阶段 R3：产品化 Observatory / Audit UI；R4：LangGraph/CrewAI/AutoGen 等外部 Runtime adapters 与真实模型资格矩阵。详见 `docs/product/07_R2_Real_Execution.md`。

---

# PPL Stable Project — 2026-08-27

这是 PPL（Persona / Policy / Protocol Layer）的**规范化 Stable 项目包**。本目录从历史聚合包重新整理，目标是：

- 每个当前 Stable 组件只保留一份 canonical source；
- 不在源码树里并列保留已被新 Stable 替代的 Host/Life 版本；
- 将源码、可安装发布件、规则资产、发布证据和文档分层；
- 删除 RC/HF/重复 Promotion wrapper、冗长验证日志和旧版聚合说明造成的噪声；
- 保留足够 provenance，使每个当前组件都能追溯到原始 Stable/Promotion artifact。

## 当前正式基线

| 层 | 组件 | 版本/状态 |
|---|---|---|
| Foundation | PPL Core | `0.3.0 Frozen` |
| Foundation | PPL Runtime | `0.1.0 Frozen` |
| Foundation | PPL Profiles | `0.2.0 Stable` |
| Governance | PPL Multi-Agent Governance | **`0.1.0 Stable`** |
| Application | PPL LLM Host Adapter | **`0.1.13 Stable`** |
| Application | PPL Life Host Binding | **`0.1.1 Stable`** |
| Application | PPL App / Observatory | `0.5.0 Stable` |
| Infrastructure | Local Provider | `0.1.0 Stable` |
| Infrastructure | LM Studio Native Judge Transport | `0.1.0 Stable` |
| Integration | DeepSeek Harness Adapter | `0.1.0 Stable` |
| Integration | DSH Persona Inspector | `0.1.0 Stable`（legacy optional UI） |
| Experience | Experience Rule Evolution | **`0.2.0 Stable`** |

首个 validated Experience Rule：

`rule_research_conflict_erasure_prejudge_fastpath@0.1.0`

## 目录

```text
components/
  foundation/       Core / Runtime / Profiles
  governance/       Multi-Agent Governance (handoff/authority/fidelity plane)
  application/      Host / Life Binding / Observatory
  infrastructure/   Local Provider / LM Studio Native Judge
  integrations/     DeepSeek Harness Adapter / Persona Inspector
  experience/       Experience Rule Evolution
rules/               validated rules + capsules
dist/npm/            当前随聚合包提供的 Stable npm artifacts
docs/                当前规范文档
evidence/            精简 Promotion evidence + 必要 raw evidence
manifest/            版本矩阵、组件清单、来源与全包哈希
provenance/          清理记录与原始归档哈希
```

## 推荐 Application 链

```text
Profiles 0.2
    ↓
MAG 0.1.0 (optional governance plane for multi-agent handoffs; not orchestration)
    ↓
Host 0.1.13
    ├─ Local Provider 0.1.0 (Agent transport)
    ├─ LM Studio Native Judge 0.1.0
    ├─ Life Binding 0.1.1 (Life domain, as needed)
    └─ Experience Rule Evolution 0.2.0 (default off; validated rules only in enforce)
    ↓
Observatory 0.5 (read-only visibility)
```

Experience Rule Evolution 不生成用户答案。它把真实运行经验提炼为 provenance-bound deterministic rules；未知问题仍保留 Judge 路径，安装 Host 后规则不会自动开启。

## 快速验证

关键组件可分别在对应目录执行其自身 README 中的测试命令。Host Stable 的源码包定义：

```bash
cd components/application/host
npm ci --offline
npm test
npm run check
```

PPL Multi-Agent Governance：

```bash
cd components/governance/multi-agent-governance
npm test
npm run check
```

Experience Rule Evolution：

```bash
cd components/experience/rule-evolution
npm test
```

Life Binding：

```bash
cd components/application/life-binding
npm test
```

> 其他组件的依赖/构建方式以各自源码 README/package.json 为准；本规范化包没有擅自重写 Stable 产品内部依赖。

## 重要边界

- `components/` 中不包含 Host 0.1.6、Host 0.1.12、Life 0.1.0 等被当前 Stable 明确替代的旧源码。
- R0/R1/R2 runtime Gene Overlay 资格包不属于当前 Stable 产品树；R2 raw result 仅作为 Rule Evolution 的经验来源证据保留。
- DeepSeek Harness Adapter 与 Application Host 是不同集成边界；不要把 DSH Runtime Adapter 当作 Host transport adapter。
- MAG 是治理平面，不调度 Agent、不拥有模型/队列/工具生命周期；Execution Graph 与 Authority Graph 必须分离。
- Observatory 是只读观察层，不拥有 Profile/Host durable-state authority。

详见 `docs/` 与 `provenance/CLEANUP_REPORT.md`。

## 项目结构验证

本包不是强行拼成一个 root npm workspace：各 Stable 组件保留自己的 package boundary，避免根级依赖解析改变已发布语义。可运行：

```bash
node tools/verify-project.mjs
```

Windows 也可直接执行 `VERIFY_PROJECT.cmd`。详细整理后测试结果见 `provenance/CLEAN_PROJECT_VALIDATION.json`。
