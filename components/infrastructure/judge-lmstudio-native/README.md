# PPL LM Studio Native Judge Transport 0.1.0 Stable

Independent policy-Judge transport for LM Studio. It uses LM Studio native `POST /api/v1/chat` with `reasoning: "off"`; PPL Host remains authoritative for strict response-contract validation, policy taxonomy, severity, delivery, and durable mutation.

Stable promotion is based on real LM Studio + Qwen3.5-9B independent-Judge evidence. Qwen3.5-0.8B is Provider-qualified but was not Judge-contract-qualified in the RC9 gate.

This package does not replace `@ppl/provider-openai-compatible-local`.
