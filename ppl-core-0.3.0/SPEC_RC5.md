# PPL 0.3-RC5 — Language Completion Pass

RC5 completed the frozen 0.3 language surface on top of the RC4 executable vertical slice.

## Added in RC5

### Module system

`module` and `import` are parsed as structured declarations. Imports are resolved into ASTs before semantic composition; PPL never concatenates module source text.

- deterministic module graph resolution
- import cycle detection (`PPL-E303`)
- exact and caret version constraints (`PPL-E304`)
- semantic aliases (`import x.y as z`)
- duplicate field rejection (`PPL-E321`)
- imported rules/invariants carry `module::member` provenance

### Custom Semantic ABI

Modules can declare:

```ppl
semantic trait responsibility_internalization {
    primitive = Float01;
    scale = standard5;
    render.priority = 74;
    label.zh_CN = "责任内化";
    descriptor.zh_CN.high = "...";
}
```

Used custom semantics are copied into the Persona IR semantic closure. Runtime/rendering therefore requires no registry lookup after build.

### Transition

`transition` produces a pending runtime state transition. The current resolution still sees the frozen pre-transition state.

A host applies it explicitly after the outer interaction succeeds.

Co-active commit + transition on the same target is rejected (`PPL-E532`). Multiple active transitions producing different target states are rejected (`PPL-E533`).

### Source tests

`test { given { ... } expect { ... } }` is compiled into deterministic Test IR and can be executed without an LLM.

`given` is intentionally restricted to runtime/host inputs:

- `relationships.*`
- `state.*`
- `context.*`
- `event.*`

### Scene

A scene is a named context/state fixture. It composes with a Persona at runtime; it never clones or rewrites the Persona source.

### Formatter

The reference `fmt` command emits canonical source formatting and is idempotent under parse -> format -> parse -> format. Comments are non-semantic and are not retained by the 0.3 formatter.

### Static type completion

RC5 adds checks for:

- logical operands
- incompatible equality comparisons
- unsupported ordered Symbol comparisons
- numeric add/sub effects and commits
- SET compatibility
- Bool requirements for enable/disable
- transition target value compatibility
- Bool invariant/test expressions

## Stable conformance additions

RC5 expanded conformance from 7 to 21 tests, including module composition, custom semantic closure, transitions, source tests, scenes, formatter idempotence, versioning, cycle detection and type errors.
