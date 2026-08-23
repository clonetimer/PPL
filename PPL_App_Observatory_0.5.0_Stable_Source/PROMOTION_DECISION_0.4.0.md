# PPL APP Observatory 0.4.0 Stable — Promotion Decision

**Decision date:** 2026-08-19  
**Decision:** Promote the 0.4 RC line to **0.4.0 Stable**.

## Why promotion is justified

- Observatory remains independently deployable and Host-neutral.
- Persona, Tutor, Research and Life sessions remain readable through the persisted app-session contracts.
- Tutor learner trajectories show mastery, uncertainty, evidence direction/weight and assistance history without rerunning resolution.
- Research claim trajectories show maturity and direction independently, including evidence flips and strong refutation.
- Evidence Bundle integrity, session validation, path traversal rejection, isolated npm installation and packed standalone startup all pass.
- `app-core`, `app-ui` and `app-standalone` contain no `@deepseek-ai/*` imports; DSH remains an optional projection adapter.

## Read-only boundary

Observatory does not reclassify historical events, rerun Persona/Profile resolvers, or write durable Profile state. Domain-model scientific/statistical validity remains the responsibility of Profiles and the Host application layer.
