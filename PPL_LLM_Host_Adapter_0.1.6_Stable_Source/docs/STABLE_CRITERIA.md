# PPL LLM Host Adapter 0.1.6 Stable Acceptance

Promotion to 0.1.6 Stable requires all provider-neutral Host criteria below.

## Regression and authority

- legacy authority-boundary regression passes;
- retry / timeout / abort lifecycle passes;
- 429 retry budget passes;
- streaming partials never mutate durable Profile state;
- Session Lease rejects stale concurrent same-session transactions;
- Restricted Tutor Observer and Research Evidence Judge gates remain enforced;
- blocked or review-only drafts cannot mutate durable state;
- policy-preserving retry commits exactly once.

## Tools and recovery

- Tool allowlist, argument schema and Host-owned provenance digest pass;
- tool idempotency passes in-process and across restart;
- append-only JSONL ToolExecutionLedger survives a real crash/restart boundary;
- changed arguments for the same callId fail closed;
- recoverable Agent-turn checkpoints validate state digest and input identity;
- crash after tool-ledger fsync but before the `tools-executed` turn checkpoint resumes without repeating the side effect;
- committed-turn replay performs no Agent, Judge, continuation or tool execution.

## Independent Judge and delivery

- Agent/Judge independence `required|preferred|disabled` enforcement passes;
- role-scoped Host-owned Judge taxonomy and severity mapping pass;
- Judge output is Host-validated even when transport only guarantees JSON-object syntax;
- a genuinely independent live Judge path is exercised;
- delivery is approved only after the independent Judge; durable Profile mutation occurs only after delivery approval.

## Packaging and live evidence

- full Host regression: 59/59 PASS;
- npm tarball isolated offline install/import passes;
- Stable-candidate demo passes;
- real LM Studio Local Provider evidence exists for Qwen3.5-0.8B Agent/tool/continuation;
- real LM Studio Native Judge evidence exists for Qwen3.5-9B with reasoning disabled;
- RC10 real lifecycle evidence proves: Qwen3.5-0.8B Agent → tool side effect → fsynced ledger → intentional process crash → new-process replay → continuation → independent Qwen3.5-9B Judge → delivery → commit → committed replay, while the tool side effect remains exactly once.

## Not claimed by this Stable decision

- live OpenAI Responses API certification;
- live Anthropic/DeepSeek provider certification;
- live certification of Ollama, vLLM or llama.cpp backends (they remain conformance-qualified where applicable);
- production rate/latency SLO certification;
- unbounded-duration production soak or multi-host distributed consensus.
