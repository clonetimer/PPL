# PPL Observatory 0.5.0 Stable Promotion Decision

Date: 2026-08-20

## Decision

Promote PPL Observatory 0.5.0-rc.1 to **0.5.0 Stable**.

## Evidence basis

This promotion is application-driven, not based only on unit tests.

Real PPL Application Mainline R2 evidence from Windows + LM Studio showed that Observatory 0.5 candidate successfully imported and preserved lifecycle data from failed real sessions across Tutor, Research and Life while keeping the 0.4 snapshot projection compatible.

Real R2 lifecycle evidence preserved:

- Tutor: 8 turn audits, 4 restart markers, 2 processes.
- Research: 1 turn audit, 2 restart markers, 2 processes.
- Life: 10 turn audits, 4 restart markers, 2 processes.
- Exact lifecycle counts were preserved by the 0.5 app-session/0.4 projection.
- Stable Observatory 0.4-compatible app-session/0.3 projections remained importable without errors.

The fact that the underlying R2 Agent application failed does not weaken the Observatory evidence: an observability tool must represent failed and blocked sessions faithfully. R2 demonstrated that 0.5 exposes those failures rather than hiding them.

## Scope

0.5.0 adds optional read-only lifecycle visibility to `ppl.app-session/0.4`:

- turn audits,
- restart markers,
- tool executions,
- recoverable-turn checkpoints,
- lifecycle summaries/timelines.

It does not own Host state, rerun Profile resolution, or mutate Agent sessions.

## Compatibility

- `ppl.app-session/0.3` remains supported.
- Existing snapshot analytics remain unchanged.
- The lifecycle block is optional.

## Promotion gates

- Unit tests: 20/20 PASS.
- Standalone smoke: PASS.
- Real R2 0.4 compatibility projection: PASS.
- Real R2 0.5 lifecycle import: PASS.
- Fresh offline package installation/import: PASS.

## Post-promotion rule

Observatory 0.5.0 is Stable / defect-driven only. Reopen only for a reproducible observability defect from real application sessions.
