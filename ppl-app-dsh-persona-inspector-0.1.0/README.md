# @ppl/app-dsh-persona-inspector 0.1.0

Read-only Persona Inspector for DeepSeek Harness. It consumes only durable PPL Host Snapshots and host `turn/end` events; historical rendering never reruns Event classification or PPL resolution.

Stable supports multiple Persona snapshots inside one host Turn. Each snapshot is identified by `Turn + Step`, while the owning Turn's terminal reason is joined onto every snapshot for applied/discarded mutation status.

DSH shell terminal display policy:

- `completed`, `max-tokens` -> pending Persona mutations are shown as applied;
- `aborted`, `blocked`, `error`, `interrupted` -> shown as discarded;
- no `turn/end` yet -> shown as pending.

Surfaces include Persona identity/fingerprint, host Turn/Step, Event, active rules, relationship state, pending commits/transitions, resolved traces/provenance, and older-history paging.

The browser plugin contributes no prompt content.
