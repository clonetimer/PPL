# 1.0.0-dev.5 / R4a Qualification & Execution Hardening

- Reproduced four dev.4 failures in an independently extracted baseline, then added regressions.
- Fixed product model identity grouping; required mode rejects same-model and shared-group configurations. Frozen Host unchanged.
- Added fail-closed owned response-contract validation, including tool-enabled/no-tool-call completion and Research extraction/analysis/review/Judge.
- Added finite non-streaming HTTP envelope for environment-created model transports; bounded HTTP/SearXNG retrieval, no redirect following, no raw backend error-body reflection.
- Added isolated endpoint/Agent/Research qualification scopes, random nonce probes, Judge positive/negative controls and credential-minimized reports.
- Retained R2 live-probe entrypoint with strict /2 report semantics; fixed POSIX wrapper invocation of the installer.
- Updated stale CURRENT_BASELINE product metadata. No new external npm dependencies or database schema migration.
- Browser HTTP E2E remains BLOCKED by environment; external model qualification remains NOT_CONFIGURED. R4b external framework adapters are not implemented. Not Stable.

---

# 1.0.0-dev.4 / R3 Observatory

- Added local browser workbench and independent operation forms for five verticals.
- Added read-only projections, stored execution history without live executors, audit filtering and diagnostic exports.
- Added explicit synthetic demo with success / counter-evidence erasure / semantic Judge rejection and Host-owned local tool results.
- Added gateway origin/host/content-type/body guards, static asset whitelist, in-process execution overlap rejection and graceful SIGTERM drain.
- Fixed strict route matching and Tutor verifier enum integration; active workspaces require Node >=22.16 (tested 22.16.0).
- Added HTTP/restart regressions, offline DOM checks and an optional browser E2E script. Browser network E2E was blocked by the environment and is NOT qualified; external models are also not qualified.
- Preserved Stable components/dist/rules source identities. No new external npm dependency, no database schema change.

---

# PPL Product Refactor Changelog

## 1.0.0-dev.3 — R2 Real Execution Integration — 2026-09-30

### Added

- `platform/execution`: OpenAI-compatible structured HTTP transport、Retrieval adapters、execution repository 与 live probe；
- Generic Agent model execution + MAG receiver-fidelity gate；
- Host-owned allowlisted tool execution、argument validation、idempotent ledger 与 model continuation；
- Research `Retrieval → Extraction → Analyst → Reviewer → Bound Delivery Judge` 执行链；
- Gateway `/execute` 与 execution-run 查询入口；
- localhost end-to-end HTTP execution qualification；
- 真实 HTTP failure injection：反证删除由 MAG 阻断、Judge reject 由 delivery gate fail-closed；
- completed Host tool ledger records 使用共享 RecordStore/SQLite 持久化；
- Agent/Research execution history 查询入口。

### Architecture decision

复用 Stable Host 的 transport / resilience / tool-lifecycle primitives，但不复用旧 Host orchestrator 作为新 Vertical 的 durable-state owner，避免 dual-writer。Research bound-delivery Judge 使用独立 structured transport，不擅自扩大现有 LM Studio Native policy-Judge contract。

### Known execution boundary

已记录的 tool-call ledger 可跨正常重启恢复，但外部 side effect 完成后、ledger 尚未持久化之前的崩溃窗口尚未由 R2 做原子 exactly-once 保证。

### Qualification boundary

自动测试证明真实 HTTP 协议路径可运行；当前构建环境没有运行中的外部 vLLM/LM Studio endpoint，因此 **不声明真实模型 live-qualified**。提供 `RUN_R2_LIVE_PROBE.*` 供部署环境执行。

## 1.0.0-dev.2 — R1 Packaging, Persistence & Multi-Vertical Split — 2026-09-30

### Added

- `platform/core`: SQLite/Memory store、revision、idempotency、Session/Audit/Evidence repositories；
- `product/agent-governance`: 通用 Multi-Agent Governance Gateway；
- `product/tutor-governance`: 独立 Tutor learner-state vertical；
- `product/life-governance`: 独立长期 Personal Assistant state/risk vertical；
- `product/character-governance`: 独立 Character/NPC state vertical；
- `product/platform-gateway`: 单进程统一 API；
- 根目录 offline workspace 安装与 SQLite restart qualification。

### Architecture decision

只统一基础设施，不统一业务 schema。Research/Tutor/Life/Character/Generic Agent 分别实现、分别验收。

### Fixed

- R0 仅内存 Session 的问题；
- product clean-install 入口缺失；
- SQLite canonical serializer 对 `undefined` 的非法 JSON 问题。

### Still deferred

- 真实 Retrieval / LLM Host / semantic Judge integration；
- Product Observatory UI；
- 外部 Agent Runtime adapter qualification。

## 1.0.0-dev.1 — R0 Product Boundary — 2026-09-30

### Added

- `product/research-governance` product layer；
- Research Session / Canonical Claim Ledger；
- governed handoff + receiver fidelity assessment；
- delivery evidence binding + explicit semantic Judge gate；
- deterministic final rendering；
- in-memory audit trail；
- HTTP API；
- `VERIFY_PRODUCT.sh` / `VERIFY_PRODUCT.cmd`；
- PPL 1.0 产品架构、MVP、迁移路线与基线问题清单。

### Product direction

- 主线：Governance / Runtime / Policy / Observatory；
- 首个 vertical：Research Governance；
- Tutor / Life / Persona / harness-specific UI 暂停主线扩张，保留兼容与回归用途。

### Known debt carried from Stable aggregation

- Local Provider 的旧 Host dependency metadata 需要在 R1 正式修正并重新资格验证；
- Life Binding 独立源码测试需要显式安装 Host peer；
- Observatory workspace 需要先安装 workspace links；
- R0 尚无持久化、真实 Retrieval、真实 LLM/Judge integration 或产品 Web UI。
