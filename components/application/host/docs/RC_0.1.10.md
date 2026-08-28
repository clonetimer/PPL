# Host 0.1.10-rc.1

Application-driven candidate based on real R8 evidence.

- Tutor policy retry: `message <= 480` and `action.rationale <= 160`; rationale must not repeat the message.
- Research report: when Host state retains opposing evidence, the user-visible message must include at least one Host-owned opposing evidence summary verbatim. Missing disclosure is a deterministic `RESEARCH_CONFLICT_ERASURE`.
- Research conflict-erasure retry receives the exact opposing summaries from the Host and must copy at least one into the user-visible message.

No Core, Runtime, Profile, Provider, or Observatory semantics are changed.
