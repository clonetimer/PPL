# R1 Execution Ledger — 2026-09-30

## Scope

R1 implements packaging, persistence and the multi-vertical split. Stable component source remains frozen; all new product work is under `platform/`, `product/`, root product packaging, manifests and product documentation.

## Decisions

1. Do not create a universal business Profile.
2. Share only infrastructure concerns: persistence, audit, idempotency, session repositories and HTTP utilities.
3. Implement five independent verticals: generic Agent Governance, Research, Tutor, Life, Character/NPC.
4. Offer a unified gateway without merging their state schemas.
5. Use SQLite as the reference durable store and MemoryRecordStore for deterministic unit tests.

## Defects found and fixed

- Initial SQLite canonical serializer emitted JavaScript `undefined` inside JSON for Character snapshots. Fixed by canonical JSON semantics: object properties with `undefined` are omitted and array `undefined` entries serialize as `null`.
- Root clean-install verification initially used an invalid `require.resolve(package/package.json)` check against packages that intentionally do not export `package.json`. Replaced by actual ESM imports and product tests.

## Qualification

- platform/core: 3/3
- Agent Governance: 2/2
- Research Governance: 7/7
- Tutor Governance: 3/3
- Life Governance: 3/3
- Character Governance: 3/3
- Platform Gateway: 1/1
- Multi-vertical SQLite restart smoke: PASS
- clean `npm ci --offline`: PASS
- MAG: 56/56
- Host: 145/145
- Profiles: 28/28
- Experience Rule Evolution: 33/33
- Observatory: 20/20
- LM Studio Judge transport: 4/4
- Stable component identity: PASS

## Exit decision

R1 is complete. Next development phase is R2: connect real Host / retrieval / Judge without collapsing vertical-specific authority boundaries.
