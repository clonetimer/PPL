# Persona Programming Language (PPL) 0.3 Stable

## 1. Status

PPL 0.3 is the first stable executable language core. “Stable” means that the language semantics and JSON interoperability boundary described here are frozen for the 0.3 line. Additive tooling may evolve without changing those semantics.

## 2. Core equation

```text
ResolvedPersona =
    StaticPersona
  + RuntimeState
  + HostContext
  + CurrentEvent
  + ActiveRuleEffects
```

Persistent changes are **not** part of that equation. They are emitted as pending commits/transitions and applied separately by the host.

## 3. Ownership model

| Namespace | Ownership | Mutation |
|---|---|---|
| `identity` | source | immutable |
| `traits` | source/computed | `effect` only |
| `values` | source/computed | `effect` only |
| `preferences` | source | immutable |
| `style` | source/computed | `effect` only |
| `behaviors` | source/computed | `effect` only |
| `relationships` | runtime | `commit` / `transition` |
| `state` | runtime | `effect` or `commit` |
| `context` | host | host injection only |
| `event` | host | host injection only |

## 4. Frozen-snapshot semantics

Every `when` expression in one resolution cycle is evaluated against the same pre-resolution snapshot. Active rules are frozen before effects are applied. An effect cannot activate another rule in the same cycle.

## 5. Effect priority semantics

Effects are grouped by `(target, priority)` and priorities execute from low to high.

Within one bucket:

- only `+=/-=` -> compose
- identical SET -> allowed
- different SET -> `PPL-E411`
- SET mixed with add/sub -> `PPL-E412`
- enable vs disable conflict -> `PPL-E413`

Source order never resolves a semantic conflict.

## 6. Numeric normalization

Numeric effect/commit arithmetic is canonicalized to 12 decimal places. `Float01` final values are clamped to `[0,1]`.

## 7. Semantic ABI

Primitive types define computation; semantic types define domain meaning.

```text
Primitive: Float01
Semantic:  std.trait.emotional_guard
```

A semantic type does not add hidden behavior. Behavior must remain explicit in rules.

Standard five-band thresholds are frozen:

```text
very_low  [0.00, 0.20)
low       [0.20, 0.40)
medium    [0.40, 0.60)
high      [0.60, 0.80)
very_high [0.80, 1.00]
```

Delta magnitude is frozen:

```text
stable < 0.10
slight < 0.25
clear  < 0.45
strong >= 0.45
```

## 8. Semantic closure

A built Persona IR embeds every semantic type actually used by the Persona, including custom module semantic types. The built artifact must be renderable without the source registry or network access.

## 9. Module semantics

`import` is semantic composition, not text inclusion.

Module composition is deterministic because:

- duplicate canonical fields are errors;
- duplicate semantic IDs are errors;
- imported rule IDs are provenance-qualified;
- source order does not provide overwrite semantics;
- dependency cycles are errors.

0.3 module aliases apply to semantic type references. Export lists, explicit `requires/conflicts`, package registries and lockfiles are deferred.

## 10. Transition semantics

A transition has:

```text
target
from[]
to
when
```

It is eligible only when the frozen snapshot target is in `from` and `when` is true. It produces a pending transition; it does not alter the current resolved persona.

## 11. Commit semantics

Commits are persistent runtime mutation proposals. `resolve()` does not mutate runtime state. The host explicitly calls `applyResolution()` (or an equivalent implementation) after successful outer interaction.

## 12. Invariants

Machine assertions are evaluated against the resolved persona. Failed assertions invalidate the Resolution. `guide` strings are semantic continuity instructions for renderers.

## 13. Tests

Source tests are deterministic Persona unit tests. They never invoke an LLM. LLM/conversation integration tests remain outside the 0.3 core.

## 14. Scenes

Scenes are named context/state fixtures. Scene context/state are defaults for that invocation. Explicit host context and explicit runtime state override scene values. Scenes never mutate the static Persona definition.

## 15. Ordered Symbols

0.3 defines ordered Symbol comparisons only for:

```text
relationships.<id>.stage
context.privacy
```

Relationship stage order:

```text
stranger < acquaintance < colleague < trusted < close < confession < lover < bonded
```

Privacy order:

```text
public < semi_private < private < absolute
```

Other Symbol values support equality/inequality but not ordering in 0.3.

## 16. Stable interoperability objects

The principal 0.3 ABI objects are:

- `StaticPersonaIR`
- `RuntimeStateInput`
- Host Context
- `PplEvent`
- `Resolution`
- pending commit patches
- pending transitions
- semantic closure

All stable schemas use the `ppl.* /0.3` identifiers represented by the JSON artifacts in `spec/`.

## 17. Host security boundary

User conversation input is data, not PPL source. Runtime source mutation and dynamic import from ordinary user messages are not part of 0.3.

PPL source has no arbitrary code execution, loops, shell, filesystem primitives, network primitives or `eval`.

## 18. Renderer contract

A renderer consumes Persona IR + Resolution. The generic renderer uses semantic descriptors, Base-vs-Resolved deltas, active behavior changes, current state, relationship, context, style and invariant guides.

Examples are hints; they never override rules or invariants.

## 19. Reference conformance

A conforming 0.3 implementation should preserve the following behaviors:

- frozen match set
- deterministic priority buckets
- explicit commit isolation
- transition isolation
- semantic closure
- standard bands/delta thresholds
- canonical namespaces
- no last-write-wins
- module cycle/version diagnostics

The reference TypeScript implementation currently passes 21 conformance tests and all embedded tests in the three reference personas.

## 20. Post-0.3 scope

Not part of 0.3 Stable:

- memory database semantics
- probabilistic/random rules
- user functions, loops or recursion
- dynamic runtime module loading
- multi-agent negotiation
- package registry / lockfile implementation
- REPL / editor language server
- LLM conversation tests
- richer user-defined ordered enums
