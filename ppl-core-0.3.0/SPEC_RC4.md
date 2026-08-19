# PPL 0.3-RC4 Reference Compiler Vertical Slice

## Status

RC3 language features are frozen. RC4 is an implementation milestone, not a new language-feature release.

## Executable pipeline

```text
PPL source
  -> lexer
  -> parser / AST
  -> symbol + semantic binding
  -> self-contained Persona IR
  -> frozen pre-resolution snapshot
  -> active rule freeze
  -> deterministic priority buckets
  -> Resolution + provenance trace
  -> semantic descriptor selection
  -> generic static/dynamic prompt render
```

## Implementation-level clarification: numeric canonicalization

RC4 canonicalizes numeric arithmetic to 12 decimal places after numeric effect/commit operations. This prevents ordinary IEEE-754 display artifacts such as `0.31999999999999995` from leaking into Persona IR traces and conformance snapshots.

This is an implementation/conformance clarification, not a change to Float01 semantic bands.

## Deterministic effect buckets

For a single `(target, priority)` bucket:

- additive-only (`+=`, `-=`) effects compose;
- identical SET values are allowed;
- different SET values -> `PPL-E411`;
- SET mixed with additive effects -> `PPL-E412`;
- enable/disable conflict -> `PPL-E413`.

Source order never resolves conflicts.

## Frozen match set

All `when` expressions are evaluated against one pre-resolution snapshot. The set of active rules is frozen before any effect is applied. An effect cannot activate another rule during the same resolution cycle.

## Commit isolation

`resolve()` only emits pending commits. Runtime state is mutated only when the host explicitly applies them after the outer interaction succeeds.

## Semantic closure

Every used standard semantic type is embedded in `semanticClosure`. Rendering the resulting Persona IR does not require querying the source registry.

## Static lint implemented

- `PPL-W251`: Float01 persona/control field without semantic type or local descriptor.
- `PPL-W310`: overlapping `traits.x` and `style.x` fields.

## Implemented RC4 syntax subset

Implemented:

- persona
- meta / identity / traits / values / preferences
- relationship / context / state / style / behavior
- primitive and `std.*` semantic type annotations
- rule / when / effect / commit
- enable / disable
- describe
- invariant assert / guide

Deferred to later implementation milestones:

- module / import
- custom `semantic` declarations
- transition
- example / test source syntax
- package resolution / lockfiles
- formatter / REPL / editor integration

These deferred items remain part of the frozen PPL design; they are simply not in the RC4 vertical slice.
