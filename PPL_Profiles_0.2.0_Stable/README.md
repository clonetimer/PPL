# PPL Profiles 0.2.0 Stable — Application Profiles

PPL Profiles 是与 **PPL Core / Runtime / APP** 平行的应用行为主线。0.2.0 Stable 的重点不是增加更多 Prompt 模板，而是把 Tutor 与 Research 推进到真实应用所需的**证据、不确定性、验证和拒绝过度结论**机制。

> 状态：**Stable**。Core 0.3.0、Runtime 0.1.0、DSH Adapter 0.1.0 保持冻结。Stable 表示软件契约与 Reference Engine 行为冻结；不表示 Tutor 已完成统计校准或 Research 结论等价于科学真理。

## 版本契约

| Contract | Version |
|---|---|
| Profile manifest | `ppl.profile/0.2`（Runtime 向后兼容 0.1） |
| Resolution | `ppl.profile-resolution/0.2` |
| Snapshot | `ppl.profile-snapshot/0.2` |
| Evaluation | `ppl.profile-evaluation/0.2` |
| Observatory export | `ppl.app-session/0.3` |

## 包结构

```text
@ppl/profile-core       通用 Profile rule / transaction / evaluation
@ppl/profile-runtime    kind → domain resolver 路由
@ppl/profile-tutor      不确定性感知学习状态 + intervention verifier
@ppl/profile-research   claim/evidence/validation ledger + conclusion gate
```

Character / Life 继续作为 0.1 generic Profile 兼容样例，不因本轮应用演化重写底层。

## Tutor 0.2

Reference Engine：`tutor/uncertainty-verifier@0.2`

- Beta posterior 工程基线：同时保留 mastery mean 与 uncertainty，而不是把一次正确答案等价为“掌握”；
- assessment validity：first-attempt / multi-attempt / hinted / answer-revealed 分权；
- stable evidence id + dedup；
- misconception 以 support/contradiction 累积；
- affect 必须由独立且有置信度的观察事件更新；
- intervention ledger；
- turn-by-turn verifier 与 learner-state estimation 分离；
- ASSISTments 2009-2010 Skill Builder CSV adapter，支持数据摘要、student/skill 过滤、`order_id` 排序和 max row 限制；
- 独立 BKT sanity reference：只用于检测方向性漂移/强反相关，不作为 PPL Tutor 的目标模型或准确率声明。

Beta posterior 是透明工程近似，不宣称复现任何特定 Knowledge Tracing 模型。

## Research 0.2

Reference Engine：`research/evidence-ledger@0.2`

- claim lifecycle；
- evidence idempotence；
- support / oppose / neutral 分离；
- independence group + correlated source downweight；
- provenance completeness；
- validation ledger 独立于 hypothesis generation；
- reproducibility signal；
- `blocked / inconclusive / qualified / ready` 只表示结论成熟度；
- `support / oppose / mixed / undetermined` 单独表示结论方向，因此强反证可以成为 `ready + oppose`；
- 冲突和不确定性不通过简单平均消失。

`ready` 仅表示满足本 Profile 的报告门禁，不代表客观科学真理已经证明。

## 快速运行

Node.js 20+，无第三方运行时依赖：

```bash
npm install
npm test
npm run validate
npm run examples
```

Tutor 应用场景：

```bash
node bin/ppl-profiles.mjs simulate \
  profiles/tutor/profile.json \
  profiles/tutor/scenarios/application-cycle.json
```

Research 应用场景：

```bash
node bin/ppl-profiles.mjs simulate \
  profiles/research/profile.json \
  profiles/research/scenarios/application-cycle.json
```

导出 Observatory：

```bash
node bin/ppl-profiles.mjs export-app \
  profiles/tutor/profile.json \
  profiles/tutor/scenarios/application-cycle.json \
  > tutor.app-session.json
```

## ASSISTments 真实数据工作流

先检查下载的 CSV，而不是直接把几十万行全部变成 Scenario：

```bash
node bin/ppl-profiles.mjs inspect-assistments \
  skill_builder_data_corrected_collapsed.csv
```

然后选择 student/skill：

```bash
node bin/ppl-profiles.mjs import-assistments \
  skill_builder_data_corrected_collapsed.csv \
  --user <USER_ID> \
  --skill <SKILL_NAME_OR_ID> \
  --max 100 \
  --out assistments-real-trace.json
```

最后：

```bash
node bin/ppl-profiles.mjs simulate \
  profiles/tutor/profile.json \
  assistments-real-trace.json
```

仓库内 `applications/tutor/assistments-compatible-trace.csv` **只是 documented-schema fixture，不声称来自真实学生。** Stable promotion 仍要求独立真实数据 trace。

## Transaction

Profiles 保持：

```text
Resolve != Mutation
```

`resolveProfileEvent()` / domain resolver 只生成 staged resolution；`finalizeProfileResolution()` 才根据 `endReason` commit 或 rollback。

Reference Profile 默认：

- `completed / max-tokens` → commit
- `aborted / error / ...` → rollback

## 规范和应用报告

- [`spec/PROFILE_SPEC_0.2.md`](spec/PROFILE_SPEC_0.2.md)
- [`docs/TUTOR_APPLICATION_EVOLUTION.md`](docs/TUTOR_APPLICATION_EVOLUTION.md)
- [`docs/RESEARCH_APPLICATION_EVOLUTION.md`](docs/RESEARCH_APPLICATION_EVOLUTION.md)
- [`APPLICATION_EVOLUTION_REPORT.md`](APPLICATION_EVOLUTION_REPORT.md)

## 不修改的底层

0.2.0 **没有要求**修改：

- PPL Core 0.3.0
- PPL Runtime 0.1.0
- DSH Adapter 0.1.0

只有 Tutor + Research 独立应用暴露出同一个 Host-neutral 底层表达缺口，才应重新打开 Core/Runtime。

## Stable 真实应用门禁

Stable promotion 使用扩大真实应用证据，而不是增加新的通用 API：

- Tutor：公开 corrected ASSISTments 镜像中的 56 条真实 row，覆盖 7 名学生、4 个 skill、10 个 hint row、17 个 repeated-attempt row、7 个 bottom-hint row；形成 11 条 user×skill trajectory。
- Tutor sanity baseline：使用一个透明的二状态 BKT reference 做方向/排序 sanity check。它不是 calibration benchmark，也不要求 PPL 与 BKT 数值一致。
- Research strong validation：GW150914 evidence 后仍 blocked；独立 GW151226 experiment validation 后允许 `ready + support`。
- Research evidence flip：ego-depletion 文献从 early `qualified + support` 转为 conflicting strong replications 下的 `inconclusive + mixed`。
- Research symmetry：以 real meta-analysis + preregistered replication evidence 验证 `ready + oppose` refutation 路径。
- Core 0.3 / Runtime 0.1 继续不修改，因为 Tutor 与 Research 暴露的仍是各自 Profile 语义，而不是共同 Host-neutral 缺口。

运行：

```bash
npm run application-gate
```

机器可读结果：`validation/PROFILES_0.2_STABLE_APPLICATION_GATE.json`。

### 仍然保留的限制

0.2.0 Stable **不声称** Tutor 已经达到 KT 模型性能或经过完整校准。当前应用门禁使用可核验的 corrected public mirror subset；官方 full/corrected dataset 仍应作为后续更大规模 calibration / robustness gate。Research 的 `ready` 也只表示本 Profile 的证据门禁已满足，不等价于科学真理。

## Stable 语义边界

0.2.0 Stable 冻结的是 Profile 0.2 contract、Tutor/Research Reference Engine 的可审计行为和 transaction/evidence semantics。

它**不承诺**：

- Tutor mastery mean 是经完整数据集校准的真实掌握概率；
- BKT sanity baseline 是性能 benchmark；
- Research `ready` 等于客观真理；
- 一个 Profile 可以替代 Host 的检索、实验、工具或事实验证。

这些属于应用级 empirical validation，后续可以在不破坏 0.2 contract 的情况下继续扩展。
