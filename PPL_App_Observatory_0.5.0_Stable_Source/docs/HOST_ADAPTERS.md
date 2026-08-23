# Host Adapter Guide — Observatory 0.4 RC

Observatory 与 Host 的边界仍然是 JSON-safe `ppl.app-session/*`。

## Standalone JSON Host

Host 直接输出 JSON 文件或 HTTP endpoint，即可零耦合接入。

推荐新 Profile Host 输出 `ppl.app-session/0.3`；Persona/旧 Host 可以继续输出 0.1/0.2。

## DeepSeek Harness

`@ppl/app-adapter-dsh` 识别 DSH export 中：

- `source.ppl`；
- `ppl.snapshot`；
- 直接 `ppl.host-snapshot/0.1`；
- 直接 `ppl.profile-snapshot/0.1` / `0.2`；
- 可识别的 `turn/end` endReason。

投影器自身不 import DSH runtime，因此 Observatory 可以在独立仓库运行。

## Profiles Runtime

PPL Profiles 0.2 可以直接通过 `toAppSession()` 输出 `ppl.app-session/0.3`，无需 Host-specific Adapter。

```text
Profile scenario / Host events
      ↓ Profile Runtime
profile snapshots
      ↓ toAppSession
ppl.app-session/0.3
      ↓
Observatory
```

## 其他 Host

新 Host 只需实现：

```text
Host session
   ↓ projection
ppl.app-session/0.1 | 0.2 | 0.3
```

禁止把数据库 handle、Cordis Context、LLM client、权限对象等 Host 内部引用泄漏进 `app-core`。
