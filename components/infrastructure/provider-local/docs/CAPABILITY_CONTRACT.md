# Provider Capability Contract 0.1 — LM Studio RC2 Notes

The transport does not treat “OpenAI compatible” as a binary property. Each server preset configures a capability record covering structured output, tool calling, tool-choice control, parallel-tool control, streaming, strict tool schema and reasoning-effort controls.

Safety behavior:

1. A request that requires unavailable tool calling is blocked locally.
2. `tool_choice=none` can be safely degraded by withholding tools when the backend lacks explicit tool-choice control.
3. Prompt-only structured output is allowed because the Host still validates the final PPL response contract before mutation/delivery.
4. `structuredOutput=none` is blocked for normal contract responses.
5. A tool-call phase may explicitly set `transportStructuredOutput=false` to prevent JSON Schema enforcement from competing with provider-native tool-call emission; continuation restores structured output by default.
6. Unknown/non-loopback endpoints require explicit opt-in.
7. The LM Studio preset assumes server-level JSON Schema + tool support, but does **not** assume undocumented `tool_choice`, `parallel_tool_calls`, or strict function-schema controls.
8. Model-level tool/structured quality remains empirical. Certification evidence must distinguish model-quality failure from transport/server failure.
