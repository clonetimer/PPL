# GPT-5.6 Sol Live Semantic Gate Provenance

The Stable promotion used the current ChatGPT conversation as a real LLM semantic endpoint before packaging.

The captured behaviors are encoded in `bin/run-stable-candidate-live.mjs` so the gate can be deterministically replayed after packaging:

- Tutor Agent first produced an intentionally over-assisted draft revealing the target answer; the restricted Policy Judge blocked it; a policy-preserving retry produced a minimal hint and exactly one intervention was committed.
- Research Agent first produced an intentionally over-certain refutation; the Policy Judge blocked it; the retry reported the Profile's `ready + oppose` conclusion while preserving claim scope.
- Agent and Judge were the same underlying GPT-5.6 Sol model, so the live run used `independenceMode=preferred` and required the same-model warning to be present.
- A side-effect-like Host tool call was replayed with the same call ID and executed only once.

This is a live **semantic** gate, not a live OpenAI API transport gate. The packaged replay verifies that the exact captured outputs continue to produce the same Host decisions after installation.
