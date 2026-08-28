# 0.1.0 Stable Promotion — R3

`0.1.0` Stable is a metadata-only promotion of `0.1.0-rc.4`. Runtime files under `src/` and `bin/` are byte-identical to the RC4 candidate.

Promotion evidence requirements satisfied:

- Summary Judge qualification: PASS (6/6 probes)
- Bound Delivery Judge qualification: PASS (6/6 probes)
- Real scenario matrix: 17/17 PASS
- Clean controls: 2/2 DELIVER
- Hard faults: 12/12 BLOCK, no hard fault recovery
- Recoverable semantic faults: 3/3 recovered
- Canonical-bound expected deliveries: 5/5
- Metric/scope regression: PASS
- Execution / Authority / Fidelity traces: consistent
- Manual user-visible delivery review: PASS

The qualification wrapper and external vLLM configuration are evidence tooling, not part of the MAG runtime product. MAG remains a governance plane and does not become an orchestration framework.
