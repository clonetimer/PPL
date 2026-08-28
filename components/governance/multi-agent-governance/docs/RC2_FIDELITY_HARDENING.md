# RC2 Information-Fidelity Hardening

RC2 was issued after R1 pre-live qualification found governance bypasses that RC1 did not cover. The changes are fail-closed and remain framework-neutral.

Protected transmission surfaces now include:

- actual received task (`taskHash` / `TASK_MUTATION`),
- canonical claim text, status, polarity, confidence, attribution and authority scope,
- sensitivity, decision-critical flag, conflict-set membership and derivation lineage,
- provenance loss **and** provenance injection,
- root-baseline cumulative metadata drift,
- new claims with no lineage (`UNSUPPORTED_SYNTHESIS`),
- new claims that merely declare valid parents but have not passed a separate derivation-validation path (`UNVALIDATED_DERIVED_CLAIM`).

A receiving adapter must provide the actual `receivedTask`. Missing task-reception evidence is itself a hard failure.
