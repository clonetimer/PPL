# PPL 0.3 Stable Validation

Validation target: TypeScript reference implementation `0.3.0`.

## Compiler conformance

```text
21 / 21 passed
```

Covered areas:

- full source -> IR -> runtime -> renderer vertical slice
- frozen rule match set
- priority bucket semantics
- effect conflict diagnostics
- explicit commit isolation
- custom semantic import aliases
- self-contained Semantic Closure round-trip
- semantic module rule composition
- transition isolation
- transition/commit conflict detection
- source-level deterministic tests
- scene overlays and explicit-input precedence
- formatter idempotence
- module version constraints
- import cycle detection
- duplicate declaration diagnostics
- semantic kind checks
- expression type checks
- ordered Symbol restrictions
- Float01 range checks
- all three reference personas

## Reference persona tests

```text
CETACEA_GIRL
  1 passed / 0 failed

ZHUANG_FANGYI
  2 passed / 0 failed

LI_ZHIYAN
  3 passed / 0 failed
```

Total embedded Persona tests:

```text
6 passed / 0 failed
```

## Semantic Closure deployment check

A compiled `zhuang_fangyi.pir.json` was JSON round-tripped and rendered without consulting the source module registry. Custom `wuling.semantic.responsibility_internalization` descriptors remained available.

## Transition check

For `ZHUANG_FANGYI` with the default `trusted` relationship and a `CONFESSION` event:

```text
current resolution stage: trusted
pending transition: trusted -> lover
```

Only `applyResolution()` changes the next runtime state to `lover`.

## Public/private counterfactual check

The same ZHUANG_FANGYI Persona IR resolves differently by context:

```text
PRIVATE_NIGHT
  PRIVATE_THAW active
  private_closeness = true
  emotional_guard 0.82 -> 0.32

PUBLIC_OFFICE
  PUBLIC_RESTRAINT active
  private_closeness = false
  style.formality 0.82 -> 0.92
```

No alternate persona file is loaded.

## Danger override check

The same LI_ZHIYAN Persona resolves both private intimacy and danger rules from one frozen snapshot. Higher-priority danger behavior disables private physical closeness and activates protection behavior.

## Known 0.3 tooling limitations

- AST formatter does not preserve comments.
- no package registry / lockfile implementation yet; filesystem module root is the reference resolver.
- no REPL or editor language server yet.
- no LLM conversation/integration test runner yet.
- no user-defined ordered enums beyond the two built-in ordered Symbol domains.

These are explicitly outside the 0.3 Stable interoperability contract.
