# PPL APP 独立化与 UI 重构方案

## 1. 当前 UI 的问题

基于当前实际运行界面（见 `assets/current-persona-inspector.png`），主要问题不是“丑”，而是信息架构仍然像内部调试页：

- 左侧 Timeline 很窄，Snapshot 只以文本行呈现，事件/提交状态辨识弱；
- 页面主体黑白灰为主，`applied / pending / discarded`、Rule 类型、状态变化缺少稳定语义色；
- `PERSONA / VERSION / FINGERPRINT / HOST TURN` 等字段偏底层，普通用户不知道先看什么；
- 英文技术标签较多，中文解释不足；
- Relationship / Mutation / Base→Resolved 都是表格式文本，缺少趋势与因果概览；
- 很难回答“这个 Persona 在最近 20 Turn 总体发生了什么”；
- APP 源码与 DSH Client Runtime/Cordis Registry 耦合，使部署独立性差。

## 2. 新定位：Persona Inspector → PPL Observatory / Studio

UI 分成两层：

### Observatory（运行观察）

面向使用者和调试者：

- Session Overview；
- Timeline；
- State Trend；
- Relationship；
- Rule Impact；
- Diff；
- Provenance；
- Diagnostics；
- Raw Evidence。

### Studio（后续作者工具）

面向 PPL 程序作者：

- `.ppl` 源码编辑；
- compile diagnostics；
- Test runner；
- IR viewer；
- rule graph；
- scene simulator；
- Profile authoring。

0.3 先完成 Observatory，Studio 后续进入 0.4+。

## 3. 源码拆分

目标结构：

```text
@ppl/app-core
  contracts / normalize / diff / analytics / diagnostics

@ppl/app-ui
  reusable React/UI components

@ppl/app-standalone
  browser app / file import / HTTP or EventSource data input

@ppl/app-adapter-dsh
  DSH Conversation View → ppl.app-session/0.1
```

核心约束：

> `@ppl/app-core` 和 `@ppl/app-ui` 禁止 import `@deepseek-ai/*`。

这样部署 standalone APP 时只需要 PPL APP 自己的源码/产物，不需要 clone DSH。

## 4. UI 信息架构

### 顶部

- 当前 Profile/Persona 名称；
- 当前 Turn.Step / Event；
- 提交状态；
- 运行状态/诊断状态；
- Host 标识折叠到次级信息。

### 左侧 Timeline

- 搜索；
- Event 类型筛选；
- Applied / Discarded / Pending 筛选；
- Rule 筛选；
- Turn group；
- 颜色点表示 terminal status。

### Overview

优先显示 4–6 个最重要数值：

- trust；
- emotional guard；
- vulnerability；
- formality；
- task progress（Profiles 后）；
- confidence/evidence（Research Profile 后）。

每项提供跨 Turn 小型折线，而不是只显示当前值。

### Rules

Rule 卡片按功能分色：

- relationship；
- affect/style；
- task；
- safety/boundary；
- evidence；
- user-model。

每张卡片展示：Rule → touched paths → mutation/provenance。

### Diff / Why

采用三栏语义：

```text
Before → After → Why
```

不是让用户自己在多个卡片之间拼因果。

## 5. 视觉设计原则

- 中文优先，英文术语作为次级标签；
- 支持 Light / Dark；
- 语义色稳定：绿色=已提交、黄色=待提交、红色=已丢弃/错误、蓝色=规则/信息、紫色=Profile；
- 数值变化使用轨迹和 delta，不使用大面积雷达图替代精确数值；
- Raw JSON 默认折叠；
- Fingerprint、schema、seq 等工程字段放进“证据/高级”视图。

## 6. 已启动的独立源码

`app-next/ppl-app-observatory-0.3.0-dev.1` 已实现第一版：

- 完全独立运行；
- 零第三方依赖；
- JSON 导入；
- 中文优先；
- 语义色；
- Timeline；
- 4 项状态趋势；
- Relationship；
- Commit/Transition；
- Rule→Impact；
- Snapshot Diff；
- Provenance；
- Raw Snapshot。

这是开发预览，不替代 Stable APP 0.1.0。
