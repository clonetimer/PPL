# R0 Product Refactor Execution Ledger

Date: 2026-09-30

## Baseline

Source: `PPL_Stable_Project_2026-08-27_MAG_0.1.0`

Initial aggregate integrity check: PASS (12 Stable components, checksum manifest valid).

## Findings before modification

- MAG standalone regression: 56/56 PASS.
- Host standalone regression after its documented offline install: PASS.
- Life Binding direct `npm test` without Host peer installed: FAIL by dependency resolution; recorded as packaging/developer-experience debt, not silently rewritten in R0.
- Observatory direct `npm test` before workspace install: FAIL by internal workspace resolution; after `npm ci --offline`, 20/20 PASS.
- Profiles direct `npm test` before workspace install likewise requires workspace linking; after `npm ci --offline`, 28/28 PASS.
- Local Provider lockfile points to a missing historical Host tarball; recorded as R1 P0 packaging debt.

## R0 changes

- Added `product/research-governance`.
- Added Research Session, canonical claim ledger, governed handoff, fidelity check, evidence-bound delivery, explicit semantic Judge gate, deterministic rendering and audit trail.
- Added zero-third-party-dependency HTTP API for the product surface.
- Added PPL 1.0 product architecture and migration plan.
- Preserved historical Stable component source identity and copied the original checksum list to provenance.

## Regression / qualification

| Surface | Result |
|---|---:|
| Product tests | 6/6 PASS |
| Product deterministic demo | PASS |
| MAG | 56/56 PASS |
| Host | 145/145 PASS |
| Profiles | 28/28 PASS |
| Experience Rule Evolution | 33/33 PASS |
| Observatory | 20/20 PASS |
| LM Studio Native Judge | 4/4 PASS |

R0 intentionally does not claim Life Binding or Local Provider clean-install remediation; both are explicitly scheduled for R1.
