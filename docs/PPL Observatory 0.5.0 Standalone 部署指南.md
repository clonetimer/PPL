# PPL Observatory 0.5.0 Standalone 部署指南

Observatory 是独立只读 APP。**不需要 DeepSeek Harness checkout，也不需要部署 Core/Runtime/Host 才能打开已有 session 文件。**

## 1. 离线安装

创建一个空目录：

```bash
npm init -y
npm install --offline \
  /path/to/packages/ppl-app-core-0.5.0.tgz \
  /path/to/packages/ppl-app-ui-0.5.0.tgz \
  /path/to/packages/ppl-app-standalone-0.5.0.tgz \
  /path/to/packages/ppl-app-adapter-dsh-0.5.0.tgz
```

## 2. 启动

```bash
npx ppl-observatory
```

默认监听：

```text
127.0.0.1:4173
```

可用环境变量覆盖：

```bash
HOST=127.0.0.1 PORT=4173 npx ppl-observatory
```

Windows PowerShell：

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "4173"
npx ppl-observatory
```

然后浏览器打开：

```text
http://127.0.0.1:4173
```

> Stable source 中 `server.mjs` 的启动 console 字符串仍可能显示旧的 `Observatory 0.4.0` 文本，这是一个显示字符串遗留；package / contracts / promotion artifact 为 0.5.0 Stable。

## 3. 导入 Session

Standalone UI 支持：

- 选择本地 JSON 文件；
- 输入 URL 加载 JSON；
- 内置 sample。

Observatory 0.5 支持 `ppl.app-session/0.1`、`0.2`、`0.3`，以及新增 lifecycle visibility 的 `0.4`。

`0.4` 可包含只读：

```text
lifecycle.turnAudits
lifecycle.restartMarkers
lifecycle.toolExecutions
lifecycle.recoverableTurns
```

Observatory 不重新运行 resolver，也不修改 Session durable state。

## 4. DSH export

安装 `@ppl/app-adapter-dsh` 后：

```bash
npx ppl-app-dsh-project dsh-session-export.json > projected.app-session.json
```

再在 Observatory UI 中打开 `projected.app-session.json`。

## 5. Profiles 直接导出

Profiles 0.2 的 CLI 可直接生成 `ppl.app-session/0.3`：

```bash
node bin/ppl-profiles.mjs export-app \
  profiles/tutor/profile.json \
  profiles/tutor/scenarios/application-cycle.json \
  > tutor.app-session.json
```

然后直接导入 Observatory。
