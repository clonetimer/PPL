
## Multi-Agent Governance — R3

Stable Promotion：PASS。

- MAG `0.1.0 Stable`，由 `0.1.0-rc.4` metadata-only promotion；runtime `src/` / `bin/` / `adapters/` 与 RC4 byte-identical。
- Summary Judge qualification 6/6；Bound Delivery Judge qualification 6/6。
- 真实 LangGraph + external vLLM：17/17 scenarios；2/2 clean DELIVER；12/12 hard faults BLOCK；3/3 recoverable semantic faults recovered。
- rejected summary 未进入 downstream Agent；hard faults 未进入 recovery。
- 5/5 expected deliveries canonical-bound；`final-metric-scope-broadening` regression PASS。
- 5/5 用户可见文本人工审查 PASS。

证据：`evidence/mag-r3/`；raw：`evidence/raw/PPL_MAG_R3_RESULTS.zip`。

# 当前 Stable 发布与验证

## Host / Life — S1.12 Q5

Stable Promotion：PASS。

- Host `0.1.12` 在当时晋升；随后 Rule Evolution R3 在其基线上形成当前 Host `0.1.13 Stable`。
- Life Binding `0.1.1 Stable` 保持当前正式版本。
- S1.12 Q5：Tutor 18/18、Research 20/20、Life 18/18、Research tools 14/14 exactly-once、semantic findings 0、Observatory PASS、人工可见文本审查 PASS。

证据：`evidence/host-life-s1.12/`。

## Experience Rule Evolution / Host — R3

Stable Promotion：PASS。

- Experience Rule Evolution `0.2.0 Stable`；
- Host `0.1.13 Stable`；
- `rule_research_conflict_erasure_prejudge_fastpath@0.1.0` validated。

真实 R3：Tutor 18/18、Research 20/20、Life 18/18、14/14 exactly-once、semantic 0、Observatory PASS；Rule evaluations 42、matched drafts 4、fast-paths 4；56/56 用户可见文本人工审查 PASS。

证据：`evidence/rule-evolution-r3/`。

## 不计入当前 Stable 的路线

R0/R1/R2 runtime Gene Overlay 没有通过 Stable Promotion。R2 raw result 被保留，是因为它是首条 Rule 的真实 failure-episode 来源之一；其 RC/HF/qualification wrapper 不属于当前 Stable 项目。
