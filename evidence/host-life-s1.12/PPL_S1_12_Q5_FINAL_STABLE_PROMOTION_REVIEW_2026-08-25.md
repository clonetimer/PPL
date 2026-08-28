# PPL Application Mainline — S1.12 Q5 Final Stable Promotion Review

**Decision: PASS — Stable Promotion authorized.**

## Promoted products

- PPL LLM Host Adapter: `0.1.12-rc.11` → **`0.1.12 Stable`**
- PPL Life Host Binding: `0.1.1-rc.4` → **`0.1.1 Stable`**

Unchanged stable/frozen foundation:

- Core `0.3.0 Frozen`
- Runtime `0.1.0 Frozen`
- Profiles `0.2.0 Stable`
- APP/Observatory `0.5.0 Stable`
- Provider `0.1.0 Stable`
- Judge Transport `0.1.0 Stable`

## Real S1.12 Q5 acceptance gates

| Gate | Result |
|---|---|
| Candidate attestation | PASS — Host `0.1.12-rc.11`, Life `0.1.1-rc.4`, Provider `0.1.0` |
| Dynamic Judge qualification | PASS — selected `qwen/qwen3-vl-4b`, 10/10 samples |
| Execution readiness | PASS — Tutor Agent, Research Agent, Policy Judge canaries all first-attempt PASS |
| Model residency/capacity | PASS — Agent 8192 context; Judge 8192 context |
| Tutor | PASS — 18/18 delivered |
| Research | PASS — 20/20 delivered |
| Life | PASS — 18/18 delivered |
| Research tool lifecycle | PASS — 14/14 unique call IDs, exactly-once materialization, no replayed execution |
| Semantic evaluator | PASS — 0 findings |
| Observatory | PASS — Stable 0.4 compatibility + 0.5 lifecycle |
| Restart/recoverable state | PASS — Tutor 6 processes, Research 5 processes, Life 6 processes; Research recoverable ledger retained |
| Manual user-visible text review | PASS — 56/56 reviewed, 0 findings |

`LIVE_APPLICATION_S1_12_CERT.json` reports `passed=true`, and structural evaluation, semantic evaluation, Observatory build, and Observatory validation all exited `0`.

## Manual review notes

Tutor responses withhold forbidden final answers and do not expose mastery/uncertainty/verifier internals. Research retains opposing evidence and the final `support` direction remains qualified rather than being presented as proven certainty. Visible “Host tool result” wording occurs only where the user explicitly requested the Host evidence tool. Life realtime facts remain per-turn service facts; durable preference/plan mutations appear only under explicit authorization; medical/financial/legal high-risk turns use the Host-owned escalation response.

## Q3–Q5 interpretation

The final clean Q5 demonstrates that the late S1.12 blockers were qualification-harness defects, not new product defects:

1. Q3 exposed an undersized Judge output budget (`256`) and was fixed at the runner/Judge execution profile layer.
2. Q4 exposed redundant per-segment model discovery and was fixed by parent-qualified model pinning.
3. Q5 added loaded-instance context-capacity attestation/reconfiguration; the real run verified Agent and Judge at 8192 context.

No Host product RC beyond RC11 and no Life product RC beyond RC4 was required.

## Promotion integrity

Stable promotion is metadata/documentation-only. Runtime-bearing Host (`src/`, `profiles/`, `bin/`) and Life (`src/`, `profiles/`) file hashes are identical to the promoted RC sources. Stable packages were then rebuilt and revalidated:

- Host `0.1.12`: 140/140 tests PASS; `npm run check` PASS.
- Life `0.1.1` against Host `0.1.12`: 5/5 tests PASS.
- Fresh offline install/import of Host `0.1.12` + Life `0.1.1` + Provider `0.1.0`: PASS.

## Final state

S1.12 is **closed**. Host `0.1.12 Stable` and Life Binding `0.1.1 Stable` are the Application Mainline stable baselines. Do not reopen S1.x or create another Host/Life RC unless new real product evidence identifies a product-layer defect.
