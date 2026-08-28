# DeepSeek Harness 集成

## 当前稳定边界

本项目保留：

- `components/integrations/deepseek-harness/adapter` — PPL DSH Adapter 0.1.0 Stable；
- `components/integrations/deepseek-harness/persona-inspector` — DSH Persona Inspector 0.1.0 Stable（legacy optional UI）。

这条集成线连接的是 **PPL Core/Runtime 与 DSH 生命周期**。它不等价于把当前 Host 0.1.13 整体嵌入 DSH，也不要把 DSH Adapter 当成 Agent/Provider transport。

Observatory 0.5 已是独立只读 APP，更适合作为当前观察入口；Persona Inspector 可以保留给已有 DSH 集成。

原 2026-08-20 文档提到的特定 clean integration kit/DSH commit 并不包含在此次上传的 All Stable Source 聚合包中，因此本规范化包不伪装提供该 installer。若需要重新对某个 DSH 版本做安装级认证，应基于实际 DSH checkout 单独做 host-diff / install replay。
