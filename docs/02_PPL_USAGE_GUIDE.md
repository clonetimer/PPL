# PPL 统一使用指南

## A. 只使用 PPL Core：把 Prompt 变成可测试 Persona 程序

进入：

```bash
cd stable-source/ppl-core-0.3.0
npm install
npm run build
npm test
```

核心命令：

```bash
node dist/src/cli.js check persona.ppl --module-root modules
node dist/src/cli.js test persona.ppl --module-root modules
node dist/src/cli.js build persona.ppl --module-root modules --out persona.pir.json
node dist/src/cli.js render persona.pir.json --runtime runtime.json --scene PRIVATE_NIGHT
node dist/src/cli.js why persona.ppl traits.emotional_guard --module-root modules
```

推荐生产边界是 `*.pir.json`：编译后已包含 Semantic Closure，部署时不要求继续携带源模块。

## B. 使用 PPL Runtime：在任意 Host 中执行

源码位于：

```text
stable-source/ppl-runtime-0.1.0/
```

Runtime 的 Host 需要提供：

- 当前 runtime state；
- Host-owned context；
- Event；
- 当前 turn / step；
- terminal outcome。

关键原则：

```text
resolve ≠ mutation
```

先产生 resolution / pending mutation；Host interaction 成功后才 commit，失败/abort 必须 rollback。

适合自行开发 Adapter 的 Host：游戏、桌面应用、Web 服务、Agent runtime、聊天框架等。

## C. DeepSeek Harness 集成

稳定 DSH Adapter 位于：

```text
stable-source/ppl-adapter-dsh-0.1.0/
```

推荐直接使用已验证的干净集成包：

```text
stable-source/ppl-stable-clean-dsh-kit-2026-08-19.zip
```

在 **纯净 DSH 0.1.0-rc.7 / commit `99f6f02...`** 上安装后，正常产品链是：

```bash
pnpm install
pnpm run build:lib:host
pnpm run build:lib:client
pnpm --filter @deepseek-ai/dsh-web-frontend run build
```

只浏览已有 PPL Session：

```bash
pnpm dsh web
```

启用 PPL Live Runtime：

```bash
PPL_LIVE=1 pnpm dsh web
```

不要把历史 Gate A/Gate B synthetic Web E2E 当作产品启动方式。

## D. PPL APP Stable 的使用

Stable APP 源码：

```text
stable-source/ppl-app-dsh-persona-inspector-0.1.0/
```

**当前限制**：0.1 Stable 是 DSH client plugin，因此不能脱离 DSH workspace 独立编译。这不是最终目标。

它适合：

- 查看 Snapshot；
- 检查规则命中；
- 检查关系状态；
- 检查 commit / transition；
- 查看 Why/provenance；
- 验证 aborted 是否正确显示为 discarded。

## E. 独立 APP 开发预览

新源码：

```text
app-next/ppl-app-observatory-0.3.0-dev.1/
```

不需要 DeepSeek Harness：

```bash
cd app-next/ppl-app-observatory-0.3.0-dev.1
npm test
npm start
```

打开：

```text
http://127.0.0.1:4173
```

它直接读取 `ppl.app-session/0.1`，底层 Snapshot 仍是冻结的 `ppl.host-snapshot/0.1`。

这条主线将成为未来 APP 的独立发布形态。
