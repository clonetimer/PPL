# PPL LLM Host Adapter 0.1.11 Stable Promotion

**Decision date:** 2026-08-21  
**Decision:** PROMOTE `0.1.11-rc.1` to `0.1.11 Stable`.

## Why promotion is justified

The real Windows + LM Studio R10 result closed the last two application regressions left after R8/R9:

1. **Tutor final-answer leak restricted repair**
   - the replayed real leak draft was blocked deterministically as `TUTOR_FINAL_ANSWER_LEAK`;
   - live Qwen3.5-0.8B produced the Host-restricted repair with `finish_reason=stop` and `reasoning_tokens=0`;
   - live Qwen3.5-9B Judge returned compliant;
   - the retry did not leak the configured final answer.

2. **Research opposing-evidence disclosure restricted repair**
   - the replayed real report was blocked deterministically as `RESEARCH_CONFLICT_ERASURE`;
   - live Qwen3.5-0.8B produced the Host-owned natural-language disclosure containing the exact opposing evidence summary;
   - the visible text contained no internal policy/retry meta language;
   - live Qwen3.5-9B Judge returned compliant;
   - `ready/support` remained mirrored and counter-evidence remained retained.

## Regression / packaging evidence

- Host regression: **77/77 PASS**.
- Stable-candidate demo: **PASS**.
- Clean-source offline install: **PASS**.
- npm tarball fresh offline install/import: **PASS**.
- Public exports include recoverable lifecycle and Host adapter APIs.

## Stable boundary

0.1.11 supersedes 0.1.7 as the recommended Host baseline. The rejected 0.1.8–0.1.10 RCs remain historical evidence only.

This promotion does **not** claim live OpenAI Responses API certification, distributed multi-host consensus, or production SLO certification.
