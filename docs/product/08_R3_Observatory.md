# R3 Observatory：实现规格与操作流程

## 背景与目标

R2 已有执行、领域治理和持久化接口，但需要直接读 JSON 才能定位错误。R3 让本机操作者看到“哪条证据经哪个 Agent 传递、在哪个门禁停止”，并能操作现有领域服务。目标不是增设一个统一万能 Profile，而是共用工作台骨架，保持五个领域独立。

## 用户角色与权限假设

当前只有本机可信操作者，没有在线账号或角色权限系统。应用内 Agent authority 是工作流授权语义，不等于 HTTP 用户认证。工程集成方负责可信 Host / 模型 / 工具配置，浏览器不能直接注入模型凭据或注册执行器。

## 核心流程

正常流程：打开工作台 → 选择应用 → 新建会话 → 领域操作 / 已配置的模型执行 → 读取实际存储的 Session、Execution、Evidence、Audit → 检查门禁 → 查看可交付结果或失败详情 → 手动确认导出。

演示流程：启动 `demo:observatory` → 查看常驻 FIXTURE 标识 → 依次打开成功、反证遗漏、Judge 拒绝三个研究会话 → 比较最后执行结果与领域状态 → 查看 Agent 工具结果 → 切换另外三种独立应用。

## 功能与验收标准

| 功能 | 实现与验收条件 |
|---|---|
| 统一外壳 | 五应用导航、搜索分页、加载 / 空 / 失败状态；改变 app 不混用 session namespace |
| Research | 支持与反对主张、来源、冲突集合都可查；候选未通过 Judge 不显示成最终回答 |
| Agent | 独立合约 / 投影 / fidelity；工具请求最终由 Host 注册和执行，展示持久化来源 |
| Tutor | 提示次数、尝试次数不丢失；验证枚举严格使用 progress / neutral / regress |
| Life | 写偏好和计划前页面要求显式确认；实时值不自动进入长期 profile |
| Character | 确定性关系事件独立记录，不接受 Research 状态对象作为统一替代 |
| 只读观测 | 页面读取不会新增审计、创建交付或触发执行；POST 到观测路径返回 405 |
| 离线历史 | 移除 execution dependency 后仍可读历史执行与工具 ledger 信息 |
| 并发 | 同进程同 app/session 的执行重叠返回 409；正常返回和异常都会释放锁 |
| 导出 | JSON 汇总详情 / 审计 / 执行；显式说明仍含业务数据且非签名审计证明 |

## API 合同

`/v1/observatory/status` 给出版本、fixture/local 模式和执行器 configured。这里的 `externalLiveQualified:false` 是本构建的验证边界，不是实时探活结果。

`/v1/observatory/sessions` 支持 app、q、status、limit、offset；limit 默认 25，范围 1..100；offset 必须非负整数。返回 items/total/limit/offset/hasMore。`status` 表示领域状态，`displayStatus` 优先采用最近执行的终态；两者都保留。

`/v1/observatory/apps/:app/sessions/:id` 返回独立 `domain` 与存储会话的脱敏副本。子路径 audit 按原顺序编号，可按 type 筛选；executions 按更新时间排序；executions/:runId 校验归属，不可从另一个会话读取。export 汇总当前记录，是诊断快照而非不可抵赖证明。

模型执行继续使用 `POST /v1/{research|agent}/sessions/:id/execute`。服务未配置返回 503；不存在的会话返回 404；同进程执行重叠 409。没有持久化后台队列或自动补跑。

## 非功能要求与安全实现

无需前端构建服务、CDN 或新增 npm 第三方包。HTML/CSS/ESM 静态文件与 JSON API 同源。静态资源使用精确白名单路径；用户 URL 不参与任意文件读取。输出使用 textContent，外链只接受 HTTP(S)，拒绝 javascript/data 方案与 URL userinfo。

Gateway 发出 CSP、nosniff、frame/referrer 等头，限制 Host / Origin / Fetch Metadata；写请求必须是 JSON object，最大 1MiB，超过限制返回 413。请求语法与来源验证已做 HTTP 回归；不把 HTTP 头检查等同于浏览器 CSP 完整验证。

前端做请求中的互斥、异步结果过期保护、路由选择恢复与键盘焦点标记。390px DOM 布局已检查横向溢出；没有声称完成读屏、全部浏览器或性能基准验收。

## 边界情况与异常状态

空数据库显示引导，不伪造数据。模型未配置禁用新执行，但不屏蔽历史。读取失败保留错误说明；网络写入失败提示先刷新确认，不能假定服务器未执行后直接重试。中断留下 started 的记录仅说明未终结。

反证遗漏显示具体 findings；Judge 拒绝显示候选判定，不渲染为最终回答。历史交付与后续手工添加证据是两个时间点，后续修改不会重新为历史交付背书。未知 app/session、错误 run 归属、超大 body、畸形 JSON、无关路径尾缀全部有失败路径测试。

Life 页面确认是交互约束，不是抗恶意本机客户端的授权证明。旧领域 API 仍属于可信 Host-facing API。导出会脱敏常见 key / token / Bearer / URL 参数，但任意自然语言、私人资料或非标准凭据仍可能存在。

## 当前待确认

生产用户是否需要多租户、远程访问和登录；最终目标浏览器 / 操作系统；真实模型、Judge 独立性和检索服务；大数据量、响应时间 / 并发目标；外部工具是否具备幂等键、事务或补偿能力。本轮不以未确认假设替代实现承诺。
