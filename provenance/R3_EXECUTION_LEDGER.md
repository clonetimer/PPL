# R3 执行台账 · PPL 1.0.0-dev.4

## 输入与范围

输入：`PPL_1.0.0-dev.3_RealExecution_R2.zip`。SHA256：`14be7ce73f66e4c7224e9adfcaf9c18418b7d3d35bdfd9a4d118fea372f873b8`。

本轮在实际解压源码上修改，不复建另一套 Agent。`components/`、`dist/`、`rules/` 冻结前缀与 R2 的 341 个文件逐项内容一致；另外继续运行原 Stable identity verifier，其历史基线条目数为 341。这两个数量分母可能不同，含义不可混淆。

## 步骤与结果

| 阶段 | 操作 | 实际结果 |
|---|---|---|
| 输入检查 | 解压 R2、恢复 ZIP 中未正确标记 UTF-8 的中文路径 | 基线完整性可读，无业务内容修改 |
| R2 基线 | 安装后执行原 VERIFY_PRODUCT | 23/23 发布检查通过，原始输出见 R3_INPUT_R2_BASELINE_CHECKS.json |
| 只读模型 | 历史执行离线查询、会话归属、分页、脱敏导出 | Observatory 12/12 测试通过 |
| Gateway | 静态资源、只读路径、请求防护、严格路由、并发互斥 | 14/14（含原2项与新增12项）通过 |
| HTTP / SQLite | 7个独立示例会话，实际HTTP读取；关闭后移除执行器重新打开 | 成功 / 反证阻断 / Judge拒绝 / Host工具 / 离线历史全部通过 |
| 完整浏览器 | Playwright Chromium 导航 localhost | 被环境 managed URL policy 拦截；ERR_BLOCKED_BY_ADMINISTRATOR；0项通过；未更改策略 |
| 离线 DOM | about:blank 载入源码、快照和模拟 fetch，不发浏览器网络请求 | 16/16 通过；页面错误0；网络请求0 |
| 产品发布入口 | 修订后的 VERIFY_PRODUCT | 25/25 检查通过；其中具备 Node test 计数的测试共 278/278 通过 |
| 文档与交付 | 模式隔离、风险边界、旧库使用说明、API和复核脚本 | 内部 checksum 清单覆盖交付文件；最终 ZIP 验证报告在外部另附 |

验证环境：Linux；Node 22.16.0；npm 10.9.2；Python 3.13.5；Chromium 144.0.7559.96。Node sqlite 仍会输出实验性提示；测试结果不改变该运行时提示。

## 发布入口明细

| 检查 | 结果 | Node tests |
|---|---|---|
| product-surface-files | PASS | 检查 / smoke |
| stable-project-integrity | PASS | 检查 / smoke |
| stable-component-identity | PASS | 检查 / smoke |
| mag-regression | PASS | 56/56 |
| host-offline-install | PASS | 检查 / smoke |
| host-regression | PASS | 145/145 |
| local-provider-regression | PASS | 16/16 |
| native-judge-regression | PASS | 4/4 |
| platform-core-tests | PASS | 3/3 |
| observatory-tests | PASS | 12/12 |
| platform-execution-tests | PASS | 4/4 |
| agent-governance-tests | PASS | 5/5 |
| research-governance-tests | PASS | 10/10 |
| tutor-governance-tests | PASS | 3/3 |
| life-governance-tests | PASS | 3/3 |
| character-governance-tests | PASS | 3/3 |
| platform-gateway-tests | PASS | 14/14 |
| agent-governance-demo | PASS | 检查 / smoke |
| research-governance-demo | PASS | 检查 / smoke |
| tutor-governance-demo | PASS | 检查 / smoke |
| life-governance-demo | PASS | 检查 / smoke |
| character-governance-demo | PASS | 检查 / smoke |
| multi-vertical-sqlite-smoke | PASS | 检查 / smoke |
| r2-http-execution-smoke | PASS | 检查 / smoke |
| r3-observatory-http-restart-smoke | PASS | 检查 / smoke |

25项检查、278个Node测试和16个DOM检查是不同口径，不能相互替代，也不能把16个DOM检查称为完整浏览器E2E。原历史 Profiles / Experience / 旧Observatory 未在本轮作为独立全量套件重跑；冻结源码身份检查不能替代它们的运行测试。

## 保留的限定

没有真实外部 Agent / Judge / 检索服务验收；fixture用例不证明语言模型能力或通用抗提示注入安全。没有Windows/macOS、Firefox/WebKit实机验证；未完成浏览器HTTP模块加载或CSP执行测试。HTTP数据源是实际产品持久化模型，DOM使用同模型快照，但分层测试不能自动推导端到端已通过。

没有用户认证、多租户、签名Judge证明、DLP、分布式任务队列、崩溃窗口副作用原子exactly-once或生产性能承诺。截图是离线DOM/fixture预览，见 docs/product/r3-preview/README.md。
