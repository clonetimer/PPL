# PPL DeepSeek Harness 部署指南

## 1. 适用范围

当前已有明确、可追溯 Stable 部署证据的 DSH 原生集成包括：

```text
PPL Core 0.3.0
PPL Runtime 0.1.0
PPL DSH Adapter 0.1.0
PPL DSH Persona Inspector 0.1.0（可选、历史 UI）
```

当前推荐 APP **Observatory 0.5.0 不需要嵌入 DSH**。它可在独立目录运行，通过 `@ppl/app-adapter-dsh` 将 DSH session export 投影成 `ppl.app-session/*` 后查看。

PPL Profiles 0.2、Host 0.1.6、Local Provider、Native Judge、Life Binding 是独立 Application Host 栈，**没有要求 clone DSH 才能运行**。目前也没有把 Host 0.1.6 整体注入 DSH 的单独 Stable bridge；不要把旧 DSH Runtime Adapter 当成 Host 0.1.6 transport adapter。

## 2. 已认证的 DSH 基线

Stable clean kit 固定的 reference host：

```text
DeepSeek Harness: 0.1.0-rc.7
commit: 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca
```

如果你的 DSH 不是这一版本/commit，不要直接假定 patch 兼容。应先做新的 host-diff / install replay 验证。

## 3. 推荐：从纯净 DSH 开始

不要在以前被手工改过的 DSH 目录上覆盖安装。Clean installer 会拒绝 dirty / contaminated host。

在 DSH 根目录确认：

```bash
git rev-parse HEAD
git status --short
```

要求：

```text
HEAD = 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca
git status --short = 空
```

## 4. 使用本 Release Kit 中的 clean integration kit

先解压：

```text
deployment/deepseek-harness/ppl-stable-clean-dsh-kit-2026-08-19.zip
```

### Git Bash / Linux shell

从 DSH 根目录：

```bash
export PPL_RELEASE=/path/to/ppl-stable-clean-dsh-kit-2026-08-19
node "$PPL_RELEASE/integrations/deepseek-harness-0.1.0-rc.7/install-clean-ppl-stable.mjs"
pnpm install
node "$PPL_RELEASE/integrations/deepseek-harness-0.1.0-rc.7/verify-clean-ppl-stable.mjs"
pnpm run build:lib:host
pnpm run build:lib:client
pnpm --filter @deepseek-ai/dsh-web-frontend run build
```

### Windows PowerShell

```powershell
$env:PPL_RELEASE = "D:\path\to\ppl-stable-clean-dsh-kit-2026-08-19"
node "$env:PPL_RELEASE\integrations\deepseek-harness-0.1.0-rc.7\install-clean-ppl-stable.mjs"
pnpm install
node "$env:PPL_RELEASE\integrations\deepseek-harness-0.1.0-rc.7\verify-clean-ppl-stable.mjs"
pnpm run build:lib:host
pnpm run build:lib:client
pnpm --filter @deepseek-ai/dsh-web-frontend run build
```

## 5. 正常运行

仅查看已有 PPL snapshot session：

```bash
pnpm dsh web
```

启用 Runtime/DSH Adapter，为新 Persona turn 注入 PPL projection：

Git Bash：

```bash
PPL_LIVE=1 pnpm dsh web
```

PowerShell：

```powershell
$env:PPL_LIVE = "1"
pnpm dsh web
```

`PPL_LIVE` 未开启时，历史 PPL session 仍可查看，但不会产生新的 Runtime Persona projection。

## 6. Persona Inspector 的定位

`@ppl/app-dsh-persona-inspector 0.1.0`：

- 只读；
- 不贡献 prompt；
- 不重新运行 Event classification / resolver；
- 用于 DSH 内查看 Persona identity、Turn/Step、active rules、pending commits/transitions 等。

它是历史/兼容 Stable UI。新项目优先使用 Observatory 0.5。

## 7. 用 Observatory 0.5 查看 DSH export

Observatory 的 DSH Adapter **不 import DSH runtime**。可在任意独立 Node 目录安装：

```bash
npm install --offline \
  ./packages/ppl-app-core-0.5.0.tgz \
  ./packages/ppl-app-adapter-dsh-0.5.0.tgz
```

将 DSH export 投影为 Observatory session：

```bash
npx ppl-app-dsh-project dsh-session-export.json > projected.app-session.json
```

随后用 Observatory Standalone 导入 `projected.app-session.json`。

当前 DSH projector 识别 `source.ppl`、`ppl.snapshot`、Host/Profile snapshots 以及可识别的 `turn/end` reason；它不会泄漏 Cordis Context、数据库 handle、LLM client 等 Host 内部引用。

## 8. 不要做的事

- 不要把历史 `.ppl-e2e`、手工 browser gate、`apps/web/tests/ppl-*` 或 RC buildfix 带进 clean host。
- 不要把 Persona Inspector 当作 prompt 生成器。
- 不要把 DSH Adapter 0.1.0 当成 Host 0.1.6 的 provider transport。
- 不要在未验证的新 DSH commit 上静默套用旧 patch。

## 9. 本指南依据

PPL 包内依据：

- clean DSH kit `CLEAN_DSH_DEPLOY.md` / `START_CLEAN.md`；
- DSH integration README；
- `@ppl/adapter-dsh 0.1.0` source；
- Observatory 0.5 `docs/HOST_ADAPTERS.md` 与 `@ppl/app-adapter-dsh` source。
