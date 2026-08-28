# Observatory Domain Models — Tutor / Research

## 设计原则

领域视图不是第二套 Runtime，也不是前端重新计算业务状态。它只把 Profile 已持久化的 state、artifacts、diagnostics 和 transaction 组织成更适合人的视图。

因此：

```text
Profile Runtime owns semantics
        ↓ persisted snapshot
Observatory owns projection
```

## Tutor Domain View

主要读取：

- `learner.currentSkillId`
- `learner.skills.<key>.mean`
- `learner.skills.<key>.uncertainty`
- `learner.skills.<key>.evidenceWeight`
- `learner.misconceptions`
- `pedagogy.recommendedMode`
- `pedagogy.hintLevel`
- `task.recommendedDifficulty`
- `pedagogy.verifier`
- Tutor artifacts

UI 目的：让用户同时看到“模型目前认为掌握多少”和“这个判断有多不确定”，并能追到 evidence/intervention/verifier。

## Research Domain View

主要读取：

- `research.question`
- active claim
- claim `status / uncertainty / supportMass / opposeMass`
- support/oppose source groups
- provenance completeness
- validation summary
- `research.conclusionStatus`
- `workflow.nextAction`
- Research evidence/validation/decision artifacts

UI 目的：让“为什么还不能下结论”成为一等信息，而不是只展示最终总结文本。

## Generic Fallback

Character / Life / unknown future Profile kind 没有专用 renderer 时，仍然可以完整使用：

- Timeline
- State
- Diff
- Rules
- Causal Chain
- Diagnostics
- Raw Evidence

这保证新领域不会因为 APP 没有专门 UI 而不可观察。

## 0.4 real-application additions

### Tutor evidence direction

Tutor domain view now separates:

- unaided first-attempt successes;
- first-attempt failures;
- assistance episodes;
- latest evidence direction (`mastery-support` / `nonmastery-support`);
- latest evidence reason and weight.

This is necessary because assisted success and help-needed failure are not symmetric evidence.

### Research unresolved conflict

Research domain view now treats `inconclusive` as a first-class conclusion state and displays:

- material conflict flag;
- support / oppose mass;
- balance ratio;
- dominant stance;
- unresolved-conflict reasons;
- next strong-validation action.

`inconclusive` is visually distinct from `blocked`, `qualified`, and `ready`.
