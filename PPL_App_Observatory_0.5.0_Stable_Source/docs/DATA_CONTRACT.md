# PPL Observatory Data Contract 0.4 RC

## Supported Session Schemas

Observatory 0.4.0 Stable 接受：

- `ppl.app-session/0.1`
- `ppl.app-session/0.2`
- `ppl.app-session/0.3`

### `ppl.app-session/0.3`

0.3 在 0.2 基础上增加领域元数据：

```json
{
  "schema": "ppl.app-session/0.3",
  "title": "...",
  "profile": {
    "id": "research.evidence-ledger.default",
    "kind": "research",
    "engine": {"id": "research/evidence-ledger", "version": "0.2"}
  },
  "domain": {
    "profileKind": "research",
    "engine": {"id": "research/evidence-ledger", "version": "0.2"},
    "application": {}
  },
  "observability": {},
  "literature": [],
  "entries": []
}
```

## Supported Snapshot Schemas

- Persona：`ppl.host-snapshot/0.1`
- Profile：`ppl.profile-snapshot/0.1`
- Profile：`ppl.profile-snapshot/0.2`

Profile 0.2 Snapshot 的 `resolution.artifacts` 可携带领域证据，例如：

- `tutor-evidence`
- `tutor-intervention`
- `tutor-verifier`
- `research-claim`
- `research-evidence`
- `research-validation`
- `research-decision`

Observatory 可以把 artifacts 投影为领域 UI，但 artifacts 不改变通用 Rule/Mutation/Transaction 语义。

## Historical Safety

Observatory 只读取持久化 Snapshot。它不会：

- 重新分类历史事件；
- 重新执行 Persona Resolve；
- 重新执行 Profile Resolve；
- 从 UI 修改 durable session。

## Evidence Bundle

`ppl.app-evidence-bundle/0.1` 包含 normalized session、overview、rule statistics、diagnostics、causal chains 和内容完整性 fingerprint。

Fingerprint 用于检测导出后意外修改，不是密码学签名。
