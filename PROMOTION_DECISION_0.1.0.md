# PPL Runtime / Adapter / APP 0.1.0 Stable promotion decision

Date: 2026-08-19

## Decision

Promote `@ppl/runtime`, `@ppl/adapter-dsh`, and Persona Inspector from `0.1.0-rc.1` to **0.1.0 Stable**. PPL Core remains **0.3.0 Stable** and is unchanged.

No product semantics changed during the RC1 → Stable promotion.

## Evidence satisfying the original promotion gates

### Runtime / Adapter

- PPL Core conformance: 21/21 PASS; Core unchanged.
- Runtime RC1 deterministic selftest: PASS.
- Full DSH SQLite SessionPersistence public-API E2E: PASS with three close/reopen boundaries.
- Real DSH AgentLoop Gate A: PASS on exact `0.1.0-rc.7` / `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`.
- Same-Turn direct human steering at step 2: PASS.
- `max-tokens` atomic commit: PASS.
- two-snapshot `aborted` rollback: PASS.

### Persona Inspector

Original `PROMOTION_REVIEW_RC1.md` requires:

1. targeted conversation/view-model/view/bundle tests;
2. full DSH client build;
3. production web build;
4. browser bundle gate.

All are PASS on the exact reference host:

- targeted tests: **13/13 PASS**;
- full client build: PASS and real `lib/client.js` emitted;
- production web build: PASS;
- static browser bundle gate: PASS.

The project handoff already contained a real-browser Persona-tab/live Host Snapshot PASS for the alpha shell. RC1 APP changes are limited to Turn+Step multi-snapshot assembly and `max-tokens` display semantics, covered by the passing delta tests and real builds.

## Reclassified non-blocking experiments

The later synthetic Web E2E/manual-browser scaffold was **not** in the original promotion criteria and is not a Stable blocker. Failures observed there were in the certification fixture/scaffold (Windows JSON token replacement, cold-session title projection timing, Vitest-only scaffold imports, replay-fixture policy when a model call occurs), not in Persona Inspector product assertions. The experiment is retained under `certification/historical-rc1/` for future test-infrastructure work.

## Stable baseline

- PPL Core: `0.3.0` Stable
- `@ppl/runtime`: `0.1.0` Stable
- `@ppl/adapter-dsh`: `0.1.0` Stable
- Persona Inspector: `0.1.0` Stable
- Host Snapshot: `ppl.host-snapshot/0.1`
- Host Resolution: `ppl.host-resolution/0.1`
- Reference Host: DeepSeek Harness `0.1.0-rc.7`, commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`

## Post-0.1 work

Non-blocking next work remains: second host portability evidence, long-session retention/compaction characterization, host-neutral `@ppl/app-core` extraction, and a production-grade event classifier. PPL Core 0.4 remains prohibited without a concrete Core deficiency/RFC.
