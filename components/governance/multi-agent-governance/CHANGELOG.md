# 0.1.0 Stable

- Promote `0.1.0-rc.4` to Stable with no runtime code changes.
- Real R3 qualification: 17/17 scenarios; 2/2 clean controls delivered; 12/12 hard faults blocked; 3/3 recoverable semantic faults recovered.
- 5/5 expected deliveries were canonical-evidence-bound; metric/scope regression passed.
- Independent Summary Judge and Bound Delivery Judge qualifications passed; rejected summaries never reached downstream Agents; hard faults never entered recovery.
- Manual review of all five delivered user-visible texts passed.

# 0.1.0-rc.4

- Add Delivery Evidence Binding for final user-facing delivery.
- Canonical evidence is deterministically rendered and cannot be rewritten by the Reviewer.
- Add traceable `derivedConclusion.parentClaimIds` with all required-for-decision claims enforced.
- Add Bound Delivery Fidelity Judge contract with explicit `metricScopePreservation`.
- Preserve RC3 summary quarantine/fallback and one-attempt delivery regeneration.
- Triggered by R2 live manual review: `lower mean error` was broadened to `more stable` in a delivered answer while the RC3 Delivery Judge still passed.

# Changelog

## 0.1.0-rc.3
- Separate final delivery synthesis from summary fidelity.
- Add delivery-fidelity Judge request/result contracts.
- Add deterministic fidelity recovery plans: verbatim fallback for failed intermediate summaries and one-attempt governed regeneration for final delivery.
- Preserve fail-closed behavior when structural/authority gates fail.

# Changelog

## 0.1.0-rc.2

- Fail closed when received task fidelity evidence is missing and detect task mutation.
- Protect claim sensitivity, decision-required flag, conflict-set membership, derivation lineage, authority scope, and provenance injection across handoffs.
- Treat newly introduced derived claims as unvalidated until a separate claim-registration/semantic-validation path exists.
- Add cumulative checks for protected claim metadata.


## 0.1.0-rc.1

- Initial Multi-Agent Governance RC.
- Added Agent Contract, Delegation Decision, Context Projection, Handoff Envelope and Fidelity Report contracts.
- Added structural/evidentiary distortion guards and semantic-fidelity Judge boundary.
- Added framework-neutral CLI and thin Python adapter.
