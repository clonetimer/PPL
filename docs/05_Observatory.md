# PPL Observatory 0.5.0

Observatory 是独立只读 Application UI，canonical source 位于：

`components/application/observatory`

它用于查看 session、Profile state、provenance、tool/restart/recoverable lifecycle 等，不重新运行 resolver，也不修改 durable state。

DSH 场景可以使用 Observatory 内的 adapter/projector 将已有 session export 转换为可读 application session。具体命令与 contracts 以该组件 README 和 `docs/` 为准。
