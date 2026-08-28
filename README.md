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
