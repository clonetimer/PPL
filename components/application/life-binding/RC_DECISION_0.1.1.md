> Historical RC decision record. Final Stable decision: `PROMOTION_DECISION_0.1.1.md`.

# PPL Life Binding 0.1.1 RC4 Decision

Status: **RC / HOLD for sustained-soak promotion**.

RC4 is the current 0.1.1 candidate. It includes RC3 normal-service recovery and adds S1.10Q2 authorized mutation payload identity pinning.

S1.9 showed that RC2 correctly rejects an echo-only `life-service-response`, but a second free model rewrite can repeat the same invalid answer and terminate the turn. S1.9 also showed user-visible internal implementation identifiers (`PPL Life`, `life-service-response`, `quietPlaces`, `escalationRequired`) in otherwise delivered service messages.

RC3 therefore adds only the lowest-layer closeout:

- rejects internal Life contract/meta identifiers in `life-service-response` user-visible messages;
- allows an Application/Host to provide an optional `hostOwnedServiceFallback` (message + Host-authorized citations);
- exports `buildLifeHostOwnedServiceFallback()` so a failed free generation can deterministically recover without a second unconstrained model rewrite;
- retains RC2 echo detection, RC1 high-risk Host-owned copy, and explicit mutation identity contracts.

Promotion remains blocked until a clean real S1.10 sustained soak passes with the candidate stack and final user-visible review.


## RC4

S1.10Q2 keeps 0.1.1 in RC. RC4 closes authorized mutation payload identity: explicit plan/preference authorization can be pinned by the Host and repaired deterministically without model-selected substitution.
