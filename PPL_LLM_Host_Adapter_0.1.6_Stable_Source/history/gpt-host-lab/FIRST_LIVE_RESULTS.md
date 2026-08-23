# First Live GPT Results

## Tutor

真实 GPT 生成层观察到的策略迁移：

1. 第一次明确错误 `4/10` 后：`diagnose / hintLevel=1`；GPT 只要求先判断分母单位并找共同分母。
2. 相同错误概念再次出现后：`misconception-repair / hintLevel=2`；GPT 明确修复“分母可直接相加”概念，并让学习者完成最后一步。
3. 学习者在已给通分信息后回答 `11/12`，该成功作为 assisted success 降权；Profile 没有突然判定掌握。

最终：mastery=0.2792，uncertainty=0.5921，misconception 仍 active。这个结果是状态机行为证据，不是教学效果统计结论。

## Research

### Bilingual EF conflict

Profile：`inconclusive + mixed`。

GPT 输出明确保留支持/反对冲突，并要求预注册、多站点、任务/年龄分层的强验证；没有把 literature triangulation 写成确定结论。

### Ego depletion strong refutation

Profile：`ready + oppose`。

GPT 能把成熟度与方向分开表达：当前强版本 claim 被成熟地反对，而不是“blocked”。同时保留“不能排除所有条件性/小效应”的边界。

## 新暴露的 Host 缺口

仅有 Agent 角色还不够：自然语言 learner answer 与 source excerpt 需要 Observation/Judge 转换。RC1 已增加 Restricted Observer/Judge：

- Tutor Observer 必须有 Host rubric；
- 低 confidence 不入库；
- 禁止 affect 推断；
- Research Judge 必须有 Host provenance；
- Judge 只能分类 stance/relevance，不能生成来源。
