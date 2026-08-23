# OpenAI Responses Provider (preview in 0.1)

The source kit contains an optional native-`fetch` transport for the OpenAI Responses API.

Design choices:

- endpoint: `/v1/responses`;
- API key is read from `OPENAI_API_KEY` unless provided server-side;
- `store: false` is sent explicitly;
- structured outputs use `text.format` with `type: json_schema` and `strict: true`;
- streaming maps `response.output_text.delta`, function-call argument events, and final completion/failure events into the provider-neutral transport contract;
- an `X-Client-Request-Id` is generated for request traceability;
- 429 / transient HTTP failures participate in the Host retry budget.

This provider is **not part of the Stable claim until a live API smoke test is supplied**. The current package validates its HTTP body, auth/request-id behavior, 429 retry behavior, SSE text streaming, and function-call streaming against a local protocol server. The provider-neutral Host Adapter does not depend on this provider to be usable.

## Live-certification candidate additions (2026-08-19)

The provider Preview now also supports the application-stage tool continuation that the Stable Host core already made safe:

- `createOpenAIResponsesContinuationRequest()` manually carries the original PPL request, the prior `response.output` Items, and Host-owned `function_call_output` Items into the next Responses request;
- the continuation remains `store: false`, so PPL does not need OpenAI-side response persistence to resume a tool loop;
- `transportToolChoice` and `transportParallelToolCalls` map to the provider request for deterministic certification cases;
- function schemas only default to `strict: true` when their object schema is compatible with OpenAI strict function-calling requirements. Host-side PPL schema validation remains authoritative either way.

`bin/live-openai-smoke.mjs` reads `OPENAI_API_KEY` only from the local environment and never writes credentials. It emits machine JSON under `validation/live-openai/`.

A complete application-stage tool recovery gate is intentionally two-process:

1. `npm run live:openai:tool-crash -- --reset` obtains a real OpenAI function call, executes the Host side effect once, durably records the ToolExecutionLedger entry, writes a recovery checkpoint, and stops before final model completion.
2. `npm run live:openai:tool-resume` starts a new process, replays the same call ID from the durable ledger without repeating the side effect, submits the persisted tool result to OpenAI, and completes the model turn.

The provider remains Preview until real API logs pass these gates. Local protocol tests are supporting conformance only.
