# Changelog

## 0.2.0 Stable — 2026-08-19

- 从 RC3 无语义代码变更晋升。
- 冻结 `ppl.profile/0.2` / resolution 0.2 / snapshot 0.2 / app-session 0.3 应用契约。
- Tutor：冻结方向性 evidence validity、uncertainty-aware Beta reference、ASSISTments adapter、BKT sanity reference、intervention/verifier。
- Research：冻结 evidence/validation ledger、status × direction、inconclusive conflict、ready support/oppose strong-validation gate。
- Promotion evidence：28/28 tests、4 profile validation、8 examples、56 real Tutor rows / 7 students / 4 skills / 11 trajectories、real strong-validation/evidence-flip Research cases、隔离 npm 安装。
- Stable 不声明 Tutor 已校准或 Research `ready` 是科学真值。


## 0.2.0-rc.3 — 2026-08-19

### RC3 application gate

- Tutor 扩展为 56 条真实 corrected ASSISTments row、7 students、4 skills、11 条 user×skill trajectory。
- 新增 `@ppl/profile-tutor/bkt` advisory sanity baseline；检测明显方向漂移，但不把 BKT 当作 PPL 目标模型。
- Research 将 conclusion maturity 与 direction 分离：`blocked/inconclusive/qualified/ready` × `support/oppose/mixed/undetermined`。
- strong validation 的 support/oppose 对称；强反证可进入 `ready + oppose`，next action 为 `report-refutation`。
- 新增真实 strong-validation scenario（GW150914 → GW151226）与 ego-depletion evidence-flip / strong-refutation scenarios。
- strong validation 必须带可重新定位 provenance；历史 counter-evidence 保留在 ledger 中。
- Core 0.3 / Runtime 0.1 / DSH Adapter 0.1 未修改。

### RC2 mechanisms retained

- assistance 对 mastery-support 与 nonmastery-support 非对称处理。
- `inconclusive` 作为 material balanced conflict 的一等状态。
- uncertainty-aware Tutor、evidence/validation ledger、transaction rollback、Character/Life backward compatibility 保持。

## 0.1.0 Stable — 2026-08-19

- 冻结首个 `ppl.profile/0.1` 应用层契约。
- 实现 Host-neutral validator、generic deterministic resolver、transaction finalize、evaluation。
- 交付 Character / Tutor / Research / Life 四套 Reference Profiles。
