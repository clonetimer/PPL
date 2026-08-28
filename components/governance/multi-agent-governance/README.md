# PPL Multi-Agent Governance 0.1.0 Stable
PPL Multi-Agent Governance (MAG) is a governance plane for external multi-agent runtimes. It is **not** a scheduler, graph runtime, agent registry, queue, or LLM framework.

MAG keeps two independent governance questions separate:

1. **Context Projection** — what is Agent A allowed and required to hand to Agent B?
2. **Information Fidelity** — after handoff, did the information change in a way that changes evidence, uncertainty, attribution, provenance, or authority?

## Stable status

Version `0.1.0` is the Stable promotion of the `0.1.0-rc.4` runtime. The promotion is runtime-identical: `src/` and `bin/` are unchanged. Stable qualification used a real Ubuntu + LangGraph + external vLLM multi-agent run with an independent Judge, including canonical evidence binding, metric/scope regression, controlled semantic recovery, hard-fault fail-closed behavior, and manual review of every delivered user-visible response.

## Capabilities

- Agent identity / authority / capability contract
- Delegation policy, depth and cycle guard
- Tool and authority non-escalation
- Minimal context projection with sensitivity boundaries
- Conflict-set preservation and required-claim fail-closed behavior
- Provenance-bound handoff envelope
- Deterministic fidelity checks for omission, counter-evidence erasure, confidence inflation, status escalation, polarity flip, provenance loss, attribution swap, unsupported synthesis, and state contamination
- Separate semantic-fidelity Judge contract for summaries/paraphrases
- Framework-neutral CLI plus thin Python adapter for LangGraph-style runtimes

## Core rule

`canonicalText` is evidence-bearing and must not be silently rewritten. If a runtime wants to summarize, the summary travels separately and requires semantic-fidelity evidence before the handoff can be considered fully accepted.

## Quick check

```bash
npm test
npm run check
```

## CLI

```bash
ppl-mag governed-handoff request.json
ppl-mag fidelity received.json
```

## Multi-hop drift

MAG can bind a root `FidelityBaseline` and compare later downstream contexts directly to that baseline. This prevents small per-hop changes from accumulating into confidence laundering, provenance loss, or counter-evidence erasure across an agent chain. `TransmissionLedger` records contiguous handoff IDs, payload hashes, agents, and fidelity findings.


## RC2 fidelity hardening

A receiving adapter must provide both `receivedContext` and the actual `receivedTask` to fidelity assessment. RC2 fails closed if task-reception evidence is absent. Protected claim metadata now includes sensitivity, decision-critical status, conflict-set membership, derivation lineage, authority scope, and both provenance loss and provenance injection. New derived claims cannot enter a handoff merely by declaring parent IDs; they require a separate validation/registration path.


## RC3 governed recovery and delivery synthesis

RC3 separates **handoff-summary fidelity** from **final delivery synthesis**. A summary/paraphrase must remain a faithful compression of canonical claims. A final answer may contain a derived conclusion, but that conclusion must be traceable to the supplied claims and independently judged as supported.

When an LLM-produced intermediate summary fails semantic fidelity while structural hard gates remain clean, MAG can emit a `FidelityRecoveryPlan` with `verbatim-fallback`; the rejected free text is quarantined and downstream agents receive only the canonical projected payload. Final delivery can instead receive a one-attempt `regenerate-delivery` plan, after which the repaired answer must pass the delivery-fidelity Judge.

## RC4 Delivery Evidence Binding

RC4 strengthens the final Reviewer→user boundary. Evidence-bearing `canonicalText` is no longer free-text paraphrased in the final response path. `buildDeliveryEvidenceBinding()` binds required claims exactly, the Reviewer contributes only a traceable derived conclusion, `buildBoundDeliveryFidelityJudgeRequest()` adds explicit metric/scope preservation, and `renderGovernedDelivery()` deterministically renders canonical evidence plus the validated conclusion. This prevents last-mile broadening such as turning “lower mean error” into a source claim that a method is “more stable.”
