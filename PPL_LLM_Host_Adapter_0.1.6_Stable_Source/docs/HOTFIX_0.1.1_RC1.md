# Host 0.1.1 Hotfix RC1

Application-stage semantic testing exposed a Tutor false positive in Stable 0.1.0: the deterministic final-answer guard treated any occurrence of `expectedAnswer` as a leak, even when that token already existed in the learner prompt and the model merely reused it in a diagnostic question.

RC1 changes only deterministic leak classification:

- Host-supplied `rubric.leakPatterns[]` are always treated as explicit deterministic leak markers.
- Bare expected/accepted answers are deterministic leaks only when they appear in the model output **and were not already present in the user/task prompt**.
- Ambiguous cases remain subject to the Policy Judge.

No Profile state ownership, transaction, transport, tool, retry, observer, or research semantics are changed.
