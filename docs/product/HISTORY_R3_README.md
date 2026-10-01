# PPL 1.0.0-dev.4 · Observatory R3

**Development / 非 Stable。面向本机单用户的治理工作台，不是已通过生产安全认证的平台。**

R3 在 R2 的真实执行适配器和独立应用服务之上，增加浏览器工作台。Research、Agent、Tutor、Life、Character 共享导航、存储和审计展示，**不合并业务状态模型**。历史 Stable 源码、发布包及规则仍冻结。

## 先看到实际场景

先准备 Node.js >=22.16 和 npm。本次实际测试环境为 Linux、Node 22.16.0、npm 10.9.2；不声称其他系统 / 版本已通过验证。

```bash
bash INSTALL_PRODUCT.sh
npm run demo:observatory
```

手动打开 `http://127.0.0.1:8788/`。Windows 可使用 `INSTALL_PRODUCT.cmd` 后执行同一 npm 命令；该入口已提供，但本次未进行 Windows 实机验证。

这是**显式 FIXTURE 演示**：不调用真实模型，不需要 API Key，也不访问外部检索。模型和 Judge 的响应由脚本生成；治理、持久化和 Host 工具边界使用实际产品代码。页面持续显示演示标识，不能将结果用作模型质量证明。

| 预置会话 | 观察什么 |
|---|---|
| Research / `research-fixture-delivered` | 正反证据都保留，生成包含 mixed 结论的规范化交付 |
| Research / `research-fixture-erasure` | Analyst 遗漏反证，显示 `REQUIRED_CLAIM_OMISSION` / `COUNTER_EVIDENCE_ERASURE` |
| Research / `research-fixture-judge-reject` | Reviewer 过度下结论，Judge 拒绝，不展示为最终回答 |
| Agent / `agent-fixture-tools` | Host-owned 本地只读 lookup 工具执行及来源、ledger 记录 |
| Tutor / `tutor-fixture` | 带提示的作答证据、掌握度不确定性，以及干预验证 |
| Life / `life-fixture` | 长期偏好与实时观察定位信息分离 |
| Character / `character-fixture` | COMFORT 事件驱动的独立角色状态 |

演示默认使用独立数据库 `var/ppl-observatory-demo.sqlite`，不会把演示数据写进正常工作台数据库。已有演示会话不重复初始化。停止演示进程后删除该演示数据库及其 WAL/SHM 文件，可重建演示；**不要删除正常业务库**。

## 正常工作台

```bash
npm start
```

访问 `http://127.0.0.1:8787/`，默认数据库为 `var/ppl-product.sqlite`。正常入口不会自动切换到 fixture。没有配置模型时仍能创建会话、进行各领域的确定性操作、查看和导出历史；Research/Agent 的新模型执行按钮会禁用。

接本地实际模型与检索服务：

```bash
# Windows 使用 copy .env.execution.example .env
cp .env.execution.example .env
# 编辑 .env，填写你实际运行的模型 ID、完整 endpoint 和检索配置
npm run start:configured
```

`.env` 只有 `start:configured` 显式加载；`npm start` 仅使用当前进程环境，不自动读取文件。示例里的模型 ID 和检索 8790 端口都是占位值。检索服务不在本包中自动启动。R2 的 `RUN_R2_LIVE_PROBE.sh` / `.ps1` 保留，可用于外部端点验收。**配置存在不等于服务可达，也不等于 live-qualified。**

## 界面能力

Research 显示独立的规范化主张、支持 / 反对立场、来源、冲突集合、Agent 交接、保真违规、Judge 判定、最终交付。可新建研究问题、手工登记 provisional 主张，以及调用已配置的执行链。

Agent 显示合约、上下文、交接、保真检查、Host 工具结果；可独立新建合约 / 上下文并发起执行。工具由宿主注册，前端输入工具名不等于获得权限。

Tutor 提供作答、提示次数、尝试次数、干预及验证表单；Life 提供偏好、计划、实时观察定位和风险升级表单；Character 提供 COMFORT / CONFESSION 事件。它们不是硬套 Research 的证据模型，也不是本轮新增的完整 LLM 教学、私人助理或 NPC 产品。

共用功能包括分页搜索、状态和会话区分、审计筛选、历史执行详情、JSON 诊断导出、哈希路由恢复、加载 / 空 / 错误态和响应式布局。历史已交付记录不会因为后续手工编辑而重新通过验证，界面将最近执行结果与当前领域状态分开显示。

## 架构

```text
product/observatory/public       轻量 HTML/CSS/ES module 前端；无 CDN / 新 npm 依赖
product/observatory/src          只读投影、分页、诊断脱敏、静态资源服务
product/platform-gateway        本机同源入口、独立领域命令、执行并发保护
platform/core                   共享 SQLite / Repository / HTTP 工具
platform/execution              R2 模型 / 检索 / Judge / Host 执行适配
product/*-governance             五套独立业务状态与服务
components / dist / rules        历史 Stable 冻结资产
```

新增只读接口：

```text
GET /v1/observatory/status
GET /v1/observatory/sessions?app=research&limit=25&offset=0&q=...
GET /v1/observatory/apps/:app/sessions/:id
GET /v1/observatory/apps/:app/sessions/:id/audit?type=...&limit=25&offset=0
GET /v1/observatory/apps/:app/sessions/:id/executions
GET /v1/observatory/apps/:app/sessions/:id/executions/:runId
GET /v1/observatory/apps/:app/sessions/:id/export
```

旧 `/v1/{agent|research}/sessions/:id/executions` 也改成不依赖模型在线的持久化读取。未知会话、错误 app / run 归属返回 404。领域写入沿用 `/v1/{app}/sessions/...`，不通过只读观测 API 写业务。

## 验证

```bash
bash VERIFY_PRODUCT.sh
# 或 Windows: VERIFY_PRODUCT.cmd
```

该入口安装本地打包依赖并执行当前产品发布检查：冻结资产身份、MAG / Host / Provider / Judge、产品层测试、五套示例、SQLite 与 R2/R3 HTTP smoke。它**不包含完整浏览器 E2E、真实外部模型、所有历史研究组件的测试或生产安全认证**。

可选浏览器脚本需要单独准备 Python Playwright 和 Chromium，不属于离线产品安装依赖：

```bash
python tools/r3-browser-smoke.py --output local-results/r3-browser
# 显式指定浏览器时追加 --chromium-path /path/to/chromium
python tools/r3-dom-smoke.py --output local-results/r3-dom
```

本次实际 Chromium 的 URL 访问被环境管理策略阻断，`r3-browser-smoke` 在导航阶段失败，**没有通过**。已另行完成纯内存的离线 DOM 检查；它验证界面渲染、交互请求构造、惰性文本、布局，不验证 HTTP 浏览器集成、CSP 的浏览器执行或原生模块加载。HTTP 接口集成由 Node 实际网络测试覆盖，不能把两者合并宣称 E2E 通过。

## 安全与能力边界

默认启动只允许 loopback。无登录、租户隔离、RBAC、远程部署或完善 DLP；**不要映射公网或把不同信任主体共用本机视为安全隔离**。Host、Origin、跨站请求和 Content-Type 检查只是本地浏览器防护，不是鉴权。

前端不执行模型 HTML，不提供 Judge 强制通过按钮。原 Host-facing finalization API 仍处于可信调用方边界；不能据此声称拥有密码学签名的 Judge 身份验证。导出仍含业务数据，已知 credential 字段替换只是尽力脱敏。

同会话执行锁仅在单个 Gateway 进程内有效；未完成分布式锁、任务恢复 / 取消或“外部副作用与 ledger 写入”之间崩溃窗口的原子 exactly-once。遗留 `started` 记录只表示没有终态，不能认定任务仍在后台运行。

分页限制的是响应条数；底层仍扫描现有 RecordStore，不声称海量数据性能。Tutor 未通过知识追踪校准；Life 实时事实值不写长期 profile，但定位和审计元数据会保留；Character 仍是有限关系状态场景。

## R2 升级

停止旧进程并备份整个数据库（包括尚未合并的 WAL/SHM）后，将旧库配置到 `PPL_DB`。R3 未改变共享存储 schema，也不会自动重写旧业务记录；已测试关闭后重启离线读取的 fixture 路径，不等于所有用户数据已经迁移验收。不要让两个版本同时写同一 SQLite 文件。源码包不包含本机数据库、node_modules、密钥或浏览器环境。

详情：`docs/product/08_R3_Observatory.md`、`docs/product/09_R3_验收与风险.md`、`provenance/R3_EXECUTION_LEDGER.md`。截图位于 `docs/product/r3-preview/`，均标注为 **离线 DOM / fixture 渲染**。R2 文档保留为 `docs/product/HISTORY_R2_README.md`，历史测试记录不代表本轮新增验证。
