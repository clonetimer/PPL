# Changelog

## 0.4.0 Stable — 2026-08-19

- 从 RC3 无语义代码变更晋升。
- 冻结 Tutor learner trajectory、Research claim trajectory、status × direction 展示与 Evidence Bundle domainAnalytics。
- 18/18 tests、Standalone smoke、7 application sessions、Evidence Bundle integrity、隔离 npm 安装通过。
- app-core/app-ui/app-standalone 保持 Host-neutral；DSH 继续只是可选 projection adapter。


## 0.4.0-rc.3 — 2026-08-19

- 接入 PPL Profiles 0.2.0-rc.3 的扩大真实应用证据。
- 新增 `tutorLearnerTrajectory()`：长 learner trace、skill summary、mastery/uncertainty/evidence direction/assistance 跨 Turn 可视化。
- 新增 `researchClaimTrajectory()`：结论成熟度与方向分离展示，并记录状态迁移。
- Research 面板支持 `ready + support`、`inconclusive + mixed`、`ready + oppose` 三类应用结果，不再把 refutation 隐藏在 blocked/qualified。
- Evidence Bundle 增加 Host-neutral `domainAnalytics`，仍只消费持久化 Session，不重新执行 resolver。
- Standalone 新增 7 个 RC3 application sessions：4 个长 Tutor traces + 3 个 Research strong-validation/evidence-flip/refutation cases。
- app-core/app-ui/app-standalone 继续禁止 import DSH runtime。

## 0.3.0 Stable — 2026-08-19

- 从 DSH 内嵌 Persona Inspector 拆出 Host-neutral `app-core` / `app-ui` / `app-standalone`。
- 新增 `ppl.app-session/0.2`，同时支持 Persona 与 Profile Snapshot。
- 中文优先 UI、Light/Dark、语义色、Session Overview、状态趋势、Diff、Rule stats、Causal Chain、Diagnostics。
- 新增可移植 Evidence Bundle 与一致性校验。
- 新增可选 DSH export adapter；Observatory 部署不依赖 DSH。
