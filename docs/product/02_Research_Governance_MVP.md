# Research Governance Vertical（dev.3）

Research 仍是 PPL 最完整的业务 vertical，但不再承担 Tutor/Life/Character 的公共业务模型职责。

## 核心链

```text
Question
  → Canonical Claim / Evidence
  → Researcher→Analyst governed handoff
  → receiver fidelity
  → Reviewer→Delivery handoff
  → evidence binding
  → semantic Judge evidence
  → deterministic rendering
```

## 关键失败模式

- required claim omission；
- partial conflict projection；
- counter-evidence erasure；
- confidence inflation；
- provenance/sourceRef drift；
- final conclusion 与 parent evidence 不一致；
- semantic Judge 缺失或失败。

## dev.2 / dev.3 演进

- Session/Evidence/Audit 持久化；
- SQLite restart recovery；
- 可作为独立服务运行；
- 可通过统一 Gateway `/v1/research/...` 使用；
- Stable MAG 作为发布依赖，不再由产品源码直接跨目录 import。

dev.3 已增加 Retrieval/Host transport/Judge 的实际产品执行链；但本构建环境没有外部模型服务，因此不宣称具体 Qwen/vLLM/LM Studio 模型已完成 live qualification。详见 `07_R2_Real_Execution.md`。
