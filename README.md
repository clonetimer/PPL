# PPL 1.0.0-dev.5 · R4a Qualification & Execution Hardening

**Development / 非 Stable。R4a 工程改造已实现；R4 整体的真实模型、目标浏览器与外部框架资格尚未完成。**

PPL 为 Agent / Research 提供候选输出契约、权限与交接保真、证据绑定和审计；Tutor / Life / Character 保持独立业务模型。R4a 不扩展新场景，也不把这五个场景合成一种万能 Profile。

## 这一版做了什么

从原始 dev.4 中实际复现并修复四个问题：同模型因角色分组前缀被误判为独立；结构化调用只解析 JSON、不检查响应契约；检索自动跟随重定向；旧 live probe 收到 `ok:false` 仍以 0 退出。复现记录在 `provenance/R4_BASELINE_REPRO.json`，对应回归测试随包交付。

新增严格响应契约、配置身份检查、有界非流式 HTTP、隔离执行验收 CLI，以及 Judge 的正、负对照。不同应用共用这些执行基础设施，但各自的状态更新和业务流程不合并。

## 安装与工作台

需要 Node.js >=22.16。本次实际运行环境是 Linux / Node 22.16.0 / npm 10.9.2；其他系统与 Node 版本未获本次资格。

```bash
bash INSTALL_PRODUCT.sh
bash VERIFY_PRODUCT.sh
npm run demo:observatory
```

打开 `http://127.0.0.1:8788/`。这是带有 FIXTURE 标识的演示，模型、检索、Judge 使用测试替身，不能当作真实模型验收。普通无演示工作台为 `npm start`，端口 8787。

Windows 先执行 `INSTALL_PRODUCT.cmd`、`VERIFY_PRODUCT.cmd`。Windows 入口已提供，未进行 Windows 实机验证。

## 配置真实执行

```bash
cp .env.execution.example .env
# 编辑 .env：替换实际模型 ID、Agent/Judge 完整端点和检索端点
npm run start:configured
```

`.env` 由 `start:configured`、`qualify:execution` 显式加载；普通 `npm start` 不自动读取。示例不包含模型服务或检索服务，模型名称和端口只是占位配置。远程端点必须显式开启 `PPL_ALLOW_REMOTE_ENDPOINTS=1`。

required 独立性模式不再接受“同一模型换端口/换 agent、judge 分组标签”。不同模型 ID / 分组也只说明配置不同，不证明权重来源或错误统计独立。

## 新增执行验收

```bash
# 仅检查配置、Agent/Judge JSON 契约与 nonce、非空检索；不表示业务任务通过
npm run qualify:execution -- --scope endpoints

# 通用 Agent 的独立交接样例；不要求配置 Research 检索
npm run qualify:execution -- --scope agent

# 完整样例：端点、Agent、Judge 正负对照、Research 执行链
npm run qualify:execution -- --scope all --question "请替换为你的检索服务能覆盖的实际研究问题" --output local-results/r4-live.json
```

也可使用 `bash RUN_R4_QUALIFY.sh ...`；PowerShell 在安装后使用 `./RUN_R4_QUALIFY.ps1 ...`。

| Scope | 必需输入与覆盖范围 |
|---|---|
| endpoints（默认） | Agent、Judge、Retrieval 配置；仅端点契约探测 |
| agent | Agent、Judge 配置；端点探测 + 两侧规范证据交接样例；不查检索 |
| research | 三类端点、明确研究问题；端点 + Judge 正负对照 + Research 样例 |
| all | research 范围，加独立 Generic Agent 样例 |

Research 问题也可放入 `PPL_QUALIFY_QUESTION`。真实调用会使用配置的服务并可能消耗 API 配额。不要把敏感资料交给未经授权的远程服务。

退出码：`0` 为所选范围通过；`1` 为执行或判定失败；`2` 为配置/参数不完整。默认报告在 `local-results/R4_EXECUTION_QUALIFICATION.json`。报告原子写入，POSIX 新文件权限为 0600；含模型标识和摘要哈希，不保存原始问题、凭据或完整模型正文。模型 ID 本身仍可能是业务敏感信息。

验收用独立内存 Store，不读写 `PPL_DB`，不在你的正常会话内插入合成主张。`all` 的 Agent/Judge 对照是标注为 synthetic 的测试输入，Research 则走配置的检索和模型；服务真实身份不能通过一次 HTTP 响应自动认证。

## 明确限制

本轮本机配置验收为 NOT_CONFIGURED，没有可用模型/检索端点。完整 Chromium HTTP 导航仍返回 `ERR_BLOCKED_BY_ADMINISTRATOR`，记为 BLOCKED，不绕过环境策略。离线 DOM 和 localhost HTTP 测试分开记录，不等于完整浏览器端到端。

有界 HTTP 作用于 `.env` 创建的**非流式产品传输**和产品 HTTP/SearXNG 检索；直接使用冻结 Provider SDK、自定义 callback / transport 或 stream 的调用方仍负责自己的安全和超时边界。产品侧响应契约只支持项目使用的 JSON Schema 子集，未知关键字报错；不宣称完整标准兼容。

没有新增认证/多租户/分布式任务锁，也没有修复外部副作用已发生但 ledger 未落盘的崩溃窗口。配置身份不同不等于模型统计独立，两个 Judge 对照也不等于校准或可靠性基准。旧交付记录不因本次升级自动重审。Tutor 未校准；Life/Character 仍是有限领域参考产品。

## 文档与回溯

- `docs/product/10_R4a_执行边界与架构.md`：改动、业务边界、资源限制与验收标准。
- `docs/product/11_R4a_目标环境验收手册.md`：配置、退出码、失败定位和晋级门槛。
- `provenance/R4_EXECUTION_LEDGER.md`：逐项执行台账。
- `provenance/R4_CHANGE_INVENTORY.json`：相对 dev.4 的新增/修改/删除及哈希。
- `provenance/R4_PRODUCT_CHECKS.json`：发布入口的测试、smoke 与冻结身份检查。

`components/`、`dist/`、`rules/` 的冻结基线不变。旧 `provenance/R5_*` 属于历史组件发布，不是当前产品的 R5 Stable 证明。下一阶段先完成目标环境验收，再单独实现一个外部 Agent 框架适配。
