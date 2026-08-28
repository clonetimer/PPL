# PPL 规范化清理报告 — 2026-08-26

## 清理原则

1. 不修改用户上传的原始 ZIP；输出独立规范化项目。
2. 当前 Stable 产品源码只保留一份 canonical copy。
3. 已被新 Stable 明确替代的旧源码不进入 `components/`。
4. Promotion wrapper 只提取仍有价值的 source/dist/evidence，不整目录嵌套保存。
5. 原始验证日志不作为日常源码树内容；保留 promotion summary、人工审查、代码同一性和必要 raw results。
6. 失败的 RC/HF/qualification 路线不混入 Stable 源码树。

## 明确移除/扁平化的冗余

- `PPL_LLM_Host_Adapter_0.1.6_Stable_Source/`：被 Host `0.1.13 Stable` 替代。
- S1.12 Promotion 中的 Host `0.1.12` source/tgz：只保留其 Promotion evidence；当前源码使用 `0.1.13`。
- `PPL_Life_Binding_0.1.0_Stable_Source/`：被 Life `0.1.1 Stable` 替代。
- `PPL_Host_Life_Stable_Promotion_S1_12_Q5_2026-08-25/` wrapper：拆分为当前 Life source/dist + 精简 evidence。
- `PPL_GEP_Rule_Evolution_Stable_Promotion_2026-08-26/` wrapper：拆分为当前 Host/Rule source/dist、validated rule/capsule 和精简 evidence。
- 各 Promotion 中的逐命令 `.log`：不进入日常项目；关键结果由 summary/review/code-identity 保留。
- 2026-08-20 顶层 README/文档中的 Host 0.1.6、Life 0.1.0 版本矩阵：由本项目 `README.md`、`manifest/CURRENT_BASELINE.json` 和 `docs/` 替代。
- R0/R1/R2 runtime Gene Overlay RC/HF/qualification packages：不属于当前 Stable tree。仅 R2 raw A/B evidence 因支持 Rule Distillation 而保留。

## 未删除的“历史证据”

以下看似历史文件但不是冗余，因此保留：

- S1.12 Q5 raw results：支持 Life 0.1.1 和 Host 基线晋升。
- R2 A/B raw results：支持把 runtime Gene Overlay kill 掉并提炼第一条 Rule。
- R3 raw results：支持 Experience Rule Evolution 0.1.0 / Host 0.1.13 Stable Promotion。
- Promotion review / manual visible-text review / code identity：用于审计 Stable 来源。

## 源码完整性策略

本次未在各 Stable 组件内部删除 `dist/`、测试、examples 或 vendor 等内容，因为这些属于各产品自身发布面；清理只处理聚合仓库的外层冗余，避免无意改变已晋升 Stable artifact 的语义。

## 整理前后规模

- 原聚合目录：359 个文件，约 13.12 MiB（解压后文件字节总和）。
- 规范化目录：353 个文件，约 10.34 MiB（生成 SHA256 清单前统计）。
- 重点不是极限压缩，而是消除并列旧版本、Promotion wrapper 和重复日志，同时保留当前源码与可审计证据。

## 已知包装说明

Local Provider 0.1.0 的原始 Stable package metadata 仍精确依赖 `ppl-llm-host-adapter: 0.1.0`。本次清理没有静默改写产品包；当前 Host 0.1.13 本地链接下 Provider 16/16 tests PASS。若要重新发布 Provider，应在 Provider 自己的版本线上修正依赖元数据并重新资格验证。
