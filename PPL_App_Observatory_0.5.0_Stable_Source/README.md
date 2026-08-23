# PPL APP Observatory 0.5.0 — Lifecycle Visibility RC

Application-driven candidate created only after real R1 sessions confirmed that Observatory 0.4.0 could import Profile/Evidence snapshots while Agent/Judge/tool/restart audits remained sidecars.

0.5 RC adds **read-only lifecycle visibility** without rerunning any resolver:
- accepts `ppl.app-session/0.4` while retaining 0.1/0.2/0.3;
- optional `lifecycle` block with turn audits, restart markers, tool executions and recoverable-turn checkpoints;
- app-core lifecycle overview/timeline/tool/restart analytics;
- one new UI tab: **Agent 生命周期**.

0.4.0 Stable remains unchanged.
