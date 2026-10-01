# R4a 执行台账 — 1.0.0-dev.5

输入：PPL_1.0.0-dev.4_Observatory_R3.zip，SHA256 77d412f3e774b24f71113f4edbf2383297a7c0bebfac1f03ee6cabf183b997ab。版本保持 Development / 非 Stable；R4b 未开发。

| 顺序 | 动作 | 回归/观察记录 |
|---|---|---|
| 1 | 检查输入 SHA、解压并复跑 R3 发布入口 | R4_INPUT_R3_CHECKS.json：25 项通过，278 个 Node 测试 |
| 2 | 真正尝试 Chromium HTTP 端到端 | 导航被 ERR_BLOCKED_BY_ADMINISTRATOR 阻断；没有修改策略 |
| 3 | 读取执行器、配置、响应处理、检索与资格脚本 | 定位角色前缀、JSON-only、redirect、ok:false 误报 |
| 4 | 响应契约、有界 HTTP、身份、Agent/Research 集成修复 | 第一批既有目标回归 19/19 通过 |
| 5 | 补充类型/数值/nonce/超时/大小/redirect/取消与领域回归 | R4_TARGET_REGRESSION.tap：52/52 通过 |
| 6 | 实现隔离 qualifier、Judge 双向对照、报告/CLI | R4_QUALIFICATION_TESTS.tap：14/14 通过；不触碰业务数据库 |
| 7 | 单独解压原始 dev.4 再现旧问题 | R4_BASELINE_REPRO.json：四项均复现，包括旧 live probe 退出 0 |
| 8 | 真正 localhost HTTP 全链与失败注入 | R4_HTTP_SMOKE.json：六场景符合预期，明确 fixture-http |
| 9 | 本机真实配置与端点观察 | R4_CONFIGURED_ENV_QUALIFICATION.json 为 not-configured，退出 2；R4_ENVIRONMENT_PROBE.json 所列端口不可达 |
| 10 | 在 dev.5 上重跑浏览器分层检查 | R4_BROWSER_REPORT.json 为 BLOCKED；R4_DOM_REPORT.json 16/16，通过但不代表 HTTP E2E |
| 11 | 修正元数据/版本、收敛 README、保留 R3 历史与迁移边界 | 无数据库 schema 迁移；冻结组件不修改 |

完整发布入口记录另存 R4_PRODUCT_CHECKS.json；最终 ZIP 的重新解压、空 npm cache 安装与验证结果放在 ZIP 外的 R4_VALIDATION.md/json，避免循环写入自身哈希。

测试计数不要混用：Node tests、发布检查、HTTP 场景和离线 DOM 为不同层。未把浏览器/真实模型的阻断或缺配置计入通过数。历史组件身份一致不等于所有历史子组件套件在本轮重新全量测试。

## 发布入口收口

开发目录完整发布入口 27/27 通过，其中 Node 测试 325/325；独立执行冻结身份核验 341/341。最终微调保留配置错误的安全错误码后，再次运行 qualifier 14/14 通过。没有新增第三方 npm 包。干净交付目录与最终 ZIP 的验证记录在外部 R4_VALIDATION 中，不回写为虚假的实时资格。
