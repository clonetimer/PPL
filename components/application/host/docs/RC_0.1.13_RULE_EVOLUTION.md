# Host 0.1.13-rc.2 — Experience Rule Evolution

The R1/R2 runtime prompt-overlay experiment did not improve first-pass visible Research messages. This RC moves reusable experience into deterministic protocol behavior.

Known deterministic failures can be handled before an external Judge call only when a provenance-bound rule selects a Host-owned deterministic policy code. The repair remains `compileRetryRequest`; the rule cannot alter Profile policy, durable state, response contract, or the Judge path for unknown failures.

Modes:
- `off`: no rule matching/enforcement.
- `observe`: audit matching rules but always invoke Judge.
- `evaluation`: candidate rules may fast-path in explicit qualification runs.
- `enforce`: only `validated` rules are accepted.
