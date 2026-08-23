# Transport & Tool Lifecycle 0.1

## Stable-candidate transaction rule

`LLM partial output != durable mutation`.

A Profile mutation may happen only after:

1. transport reaches `completed`;
2. structured response parses;
3. response contract validates;
4. Policy Judge reaches a deliver decision;
5. Host single-writer coordinator acquires the Profile Session write slot.

Timeout, cancellation, network failure, incomplete stream, Policy `block`, or Policy `review` preserve the pre-call durable state.

## Retry

Retry budget is transport-owned. Retryable categories include rate limiting and transient server/network errors. A model transport retry never repeats a previously committed Profile mutation because mutation occurs only after one final deliverable result is selected.

## Streaming

Streaming text/function-call deltas are accumulated in Host memory. Deltas are observable for UI/logging but cannot call Profile resolution or mutation APIs. Only the finalized stream is parsed and passed to the Delivery Gate.

## Tool lifecycle

`model proposes call -> Host allowlist -> argument schema -> ToolExecutionLedger -> Host execution -> provenance-locked result`.

The model never directly executes a tool and tool output does not automatically become Tutor learner evidence or Research evidence.

ToolExecutionLedger guarantees:

- same `callId + name + arguments` -> execute once, replay stored result;
- same `callId` with changed name/arguments -> reject;
- tool result receives Host-owned execution provenance and digest.

## Concurrency

Judge/retrieval work may run concurrently, but each Profile Session is a single durable writer. The SessionWriteCoordinator serializes commits by session ID.
