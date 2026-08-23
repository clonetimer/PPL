# Changelog

## 0.1.0 — 2026-08-20

- Promoted the Local/OpenAI-compatible Provider to Stable after user-machine live certification on Windows LM Studio + Qwen3.5-0.8B.
- Live evidence passed structured invoke, structured SSE, and real tool-call → Host-owned result → continuation.
- Retained capability-driven degradation: LM Studio is live-certified; Ollama/vLLM/llama.cpp remain conformance-qualified until separate live evidence exists.
- No change to PPL Core, Runtime, Profiles, Observatory, or immutable Host 0.1.0 Stable baseline.

## 0.1.0-rc.2 — 2026-08-19

- Added first-class LM Studio preset at `127.0.0.1:1234`.
- Added `/v1/models` discovery and Qwen3.5-0.8B model-hint resolution without guessing the exact LM Studio identifier.
- Ambiguous model matches now fail closed and require an explicit model ID.
- Added optional local bearer-token support for authenticated LM Studio servers.
- Added explicit tool-call phase that can disable structured output, with structured output restored for continuation.
- Added LM Studio/Qwen3.5 certification failure classes so model/server-parser limits are not misdiagnosed as PPL defects.
- Expanded provider tests to 16/16 PASS and added an end-to-end LM Studio wire-protocol simulation.

## 0.1.0-rc.1 — 2026-08-19

- Initial provider-ecosystem extraction from the Stable Host.
- Added capability contract and conservative Ollama/vLLM/llama.cpp presets.
- Added Chat Completions structured-output, tool-call, continuation, streaming, retry-compatible transport.
- Added endpoint safety guard and non-inference provider probe.
