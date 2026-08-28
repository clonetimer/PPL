# RC3 Recovery and Delivery Synthesis

R1 live evidence showed that a governance plane can correctly detect distortion yet still be unusable if every semantic failure terminates the workflow. RC3 adds two explicitly bounded recovery paths.

1. **Intermediate handoff summaries:** if structural/context fidelity passes but the semantic summary fails, the free-text summary is quarantined and the workflow may fall back to the canonical verbatim payload. No failed summary reaches the downstream agent.
2. **Reviewer to user delivery:** the final answer is not modeled as a mere summary. It may contain a derived conclusion, but only if an independent Delivery Fidelity Judge confirms that the conclusion is supported by the canonical claims, counter-evidence and uncertainty are preserved, and no new source facts are introduced. One governed regeneration attempt may be requested after a semantic failure.

Structural authority failures, claim mutation, provenance mutation, context contamination, and cumulative laundering remain non-recoverable and fail closed.
