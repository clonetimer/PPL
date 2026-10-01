# R1 Packaging & Persistence

## 环境

Product suite 要求 Node.js >= 22.5，因为 reference SQLite adapter 使用 `node:sqlite`。Stable components 自身的历史运行要求不因此被重新定义。

## 安装

Linux/macOS：

```bash
./INSTALL_PRODUCT.sh
```

Windows：

```bat
INSTALL_PRODUCT.cmd
```

安装使用 `npm ci --offline --ignore-scripts`，依赖来自本包内 workspace 与 Stable `.tgz` 发布件。

## 验证

```bash
./VERIFY_PRODUCT.sh
```

会执行 Stable identity、MAG regression、shared kernel、五个 vertical、Gateway、五个 demo 与 SQLite restart smoke。

## 启动

```bash
npm start
```

默认监听 `127.0.0.1:8787`，数据库默认 `var/ppl-product.sqlite`。可通过 `PPL_HOST`、`PPL_PORT`、`PPL_DB` 覆盖。

## 持久化语义

- record 使用 monotonically increasing revision；
- stale revision 写入返回 conflict；
- eventId / operationId 用于 exactly-once boundary；
- 相同 id + 相同 payload 为 duplicate；
- 相同 id + 不同 payload 为 idempotency conflict；
- vertical 通过 namespace 隔离，即使 sessionId 相同也不会碰撞。
