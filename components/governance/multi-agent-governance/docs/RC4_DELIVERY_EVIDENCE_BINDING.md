# RC4 Delivery Evidence Binding

R2 live evidence passed the automated scenario matrix but manual inspection found a remaining last-mile distortion: a canonical source fact stating that Method A had **lower mean error** was restated in the user-facing answer as if the source itself said Method A was **more stable**. The Delivery Judge accepted that semantic broadening.

RC4 separates model-editable conclusion synthesis from non-editable evidence presentation.

## Contract

1. Final `delivery-synthesis` creates a `DeliveryEvidenceBinding` from the handoff.
2. All `requiredForDecision` claims must be present in `derivedConclusion.parentClaimIds`.
3. Evidence text, source attribution and provenance are copied from canonical claims and cannot be model-edited.
4. The model only proposes `derivedConclusion.text`.
5. An independent Bound Delivery Fidelity Judge checks counter-evidence integration, uncertainty calibration, attribution, conclusion support, new facts, and **metric/scope preservation**.
6. Only after those gates pass does MAG deterministically render the user-facing delivery as canonical evidence plus the validated conclusion.

This design does not prohibit legitimate derived conclusions. It prevents source facts from being silently rewritten into broader claims while preserving the ability to conclude, for example, that conflicting evidence does not justify a definitive overall-stability claim.
