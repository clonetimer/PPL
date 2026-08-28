# PPL OpenAI-Compatible Local Provider 0.1.0 Stable

Companion Provider package for the PPL LLM Host. It keeps the transport provider-neutral while adding **LM Studio as a first-class certification preset**. It does not modify PPL Core, Runtime, Profiles, Observatory, or the Stable Host baseline.

## Stable certification status

Version 0.1.0 is promoted from RC2 after live Windows LM Studio + Qwen3.5-0.8B evidence passed all required Provider gates: model discovery, structured invoke, structured SSE with no partial Profile commit, and a real tool call followed by Host-owned result continuation.

Backend qualification is explicit rather than implied:

- LM Studio + Qwen3.5-0.8B: **live-certified** for the 0.1 capability contract.
- Ollama / vLLM / llama.cpp presets: **protocol/conformance tested**, not claimed live-certified by this evidence.
- OpenAI Responses API: out of scope; this package does not certify it.

Stable here means the Provider contract and LM Studio path have crossed their declared promotion gate. It does not imply that every OpenAI-compatible server or every local model implements the same optional capabilities.

## Scope

- OpenAI-compatible `/v1/chat/completions` transport.
- Explicit presets for LM Studio, Ollama, vLLM, llama.cpp, and a conservative minimal server.
- LM Studio default endpoint: `http://127.0.0.1:1234/v1/chat/completions`.
- `/v1/models` discovery so certification does not guess the exact LM Studio model identifier.
- Capability-driven degradation instead of assuming every compatible server implements every OpenAI extension.
- Structured JSON Schema output where the server supports it.
- Host-owned tool continuation using assistant `tool_calls` + `role=tool` messages.
- Tool-call phase may temporarily disable structured output; structured final output is restored after Host tool results are supplied.
- Optional bearer-token authentication for local servers.
- Non-loopback endpoints are refused unless explicitly enabled.

## LM Studio + Qwen3.5-0.8B

The Windows certification wrapper defaults to:

- preset: `lmstudio`
- server: `http://127.0.0.1:1234/v1`
- model hint: `Qwen3.5-0.8B`

The exact model ID is resolved from `/v1/models`. For example, a local quantized model may be exposed as a longer ID such as `qwen/qwen3.5-0.8b-q4_k_m`; the harness uses the server-returned identifier instead of hardcoding a guessed name.

If more than one matching quantization/model is visible, the harness fails closed and asks for an explicit model ID rather than choosing arbitrarily.

## Real local certification

1. In LM Studio, open **Developer** and start the Local Server.
2. Ensure Qwen3.5-0.8B is visible to the server (load it, or use LM Studio JIT loading if configured).
3. From PowerShell in the RC package root:

```powershell
.\RUN_LMSTUDIO_QWEN35_CERTIFICATION.ps1
```

If multiple Qwen3.5-0.8B variants are visible:

```powershell
.\RUN_LOCAL_CERTIFICATION.ps1 -Preset lmstudio -Model "<exact id printed by /v1/models>"
```

If LM Studio server authentication is enabled, set the token only in your local process:

```powershell
$env:PPL_LOCAL_API_KEY = "<your LM Studio API token>"
```

Do not upload the token. The evidence file contains no configured API key.

The live certificate tests:

1. structured non-streaming response;
2. structured streaming response with no Profile commit from partials;
3. real model tool call → Host-owned result → continuation → structured final response.

Failures are classified. A `model-or-server-*` failure means the selected model and/or LM Studio structured/tool parser did not meet that gate; it is **not automatically a PPL transport defect**.
