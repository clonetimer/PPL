# PPL LLM Host Adapter 0.1.7 Stable Promotion

**Decision:** PROMOTE to Stable.

## Evidence

- Host 0.1.7 RC local regression: 61/61 PASS before promotion.
- Real PPL Application R4 used 0.1.7-rc.1.
- Research: no structural-contract block across any turn; all four Host tool artifacts materialized exactly once; support+oppose evidence and strong validation retained.
- Tutor: current policyMode constraint produced no structural-contract failure.
- R4 remaining blocked turns were `policy-judge-transport-failed` timeouts from the independent Qwen3.5-9B Judge; model residency confirmed both Agent and Judge already loaded. Those failures do not invalidate the 0.1.7 Host response-contract fix.
- Core 0.3, Runtime 0.1, Profiles 0.2 and Observatory 0.5 are unchanged.

## Stable boundary

0.1.7 does not change the recoverable lifecycle, exactly-once tool ledger, Judge taxonomy, or Provider implementations. It only moves Tutor/Research output constraints earlier into the Host-owned generation contract and re-validates that contract before domain-specific checks.
