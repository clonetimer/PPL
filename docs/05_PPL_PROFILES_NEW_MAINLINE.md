# 新开发主线：PPL Profiles

## 1. 为什么需要新主线

PPL Core / Runtime / APP 分别解决语言、执行和观察，但当前 Reference Persona 与 UI 仍高度围绕 Character / Relationship / Role-play。

要覆盖学习、科研、生活服务、工作助手，不能把所有能力继续塞进 `persona`。否则 Core 会逐渐变成一个混杂的 Agent Framework。

因此新增与 Core / Runtime / APP 平行的第四条开发主线：

> **PPL Profiles — 面向真实应用领域的长期行为程序配置层。**

Character 只是 Profile 的一种。

## 2. Profile 的核心抽象

```text
Profile
 = Persona
 + Mission
 + Interaction Protocol
 + User Model
 + Task State
 + Domain Policy
 + Capability Requirements
 + Evaluation Contract
```

建议独立 manifest：

```json
{
  "schema": "ppl.profile/0.1",
  "id": "research-assistant.default",
  "kind": "researcher",
  "personaProgram": "researcher.pir.json",
  "mission": {},
  "interaction": {},
  "userModel": {},
  "taskState": {},
  "domainPolicy": {},
  "capabilities": {},
  "evaluation": {}
}
```

`ppl.profile/0.1` **不是** `ppl.persona-ir/0.3` 的替代，也不要求修改 Core 0.3。

## 3. 第一批四类 Profile

### Character Profile

保留现有成熟优势：

- identity；
- relationship；
- style；
- affect；
- scenes；
- private/public behavior。

它成为兼容基线，而不是 PPL 的全部定义。

### Tutor Profile

新增应用状态：

- learner mastery；
- misconception；
- confidence；
- frustration；
- current objective；
- hint level；
- assessment state。

行为协议：

- 不直接泄露答案 / 何时给提示；
- Socratic / explanation / drill 模式；
- 根据掌握度调整难度；
- 记录学习进展而非“关系亲密度”。

### Research Profile

应用状态：

- research question；
- hypothesis；
- evidence status；
- unresolved contradictions；
- source confidence；
- next experiment/search step。

行为协议：

- 区分事实、推断、假设；
- 有引用要求时强制 evidence policy；
- 不把工具结果和模型猜测混为一谈；
- 对结论保留可追溯 provenance。

### Life Service Profile

应用状态：

- user preferences；
- routines；
- plans；
- recurring needs；
- service boundaries；
- urgency/risk。

行为协议：

- 日程/天气/地点等事实归 Host/tool 所有；
- PPL 管理“如何服务”和“用户长期偏好”，不伪造实时事实；
- 医疗/法律/财务高风险请求交由外部安全/权威数据层。

后续可增加 `Work / Project Profile`。

## 4. 与现有四层的关系

```text
PPL Profiles
  ↓ selects/configures
PPL Core 0.3 Persona Programs
  ↓
PPL Runtime
  ↓
Host Adapter + Tools
  ↓
PPL APP Observatory
```

Profiles 不直接调用工具；它声明 capability requirements 与 interaction/domain policy，具体工具执行仍由 Host 控制。

## 5. 防止“只是换名字的 Prompt”

每个 Profile 必须至少满足：

1. 有明确 machine-readable state schema；
2. 至少一个跨 Turn 状态演化；
3. 至少一个 success/abort rollback 场景；
4. 行为规则可以通过确定性 test 验证；
5. APP 可以显示关键状态轨迹；
6. 至少一个与领域目标直接相关的评价指标；
7. 不通过“多写几段自然语言 Prompt”宣称完成。

## 6. 建议仓库/版本

```text
ppl-profiles/
  spec/
  packages/profile-core/
  profiles/character/
  profiles/tutor/
  profiles/research/
  profiles/life/
  examples/
  tests/
```

首版：`PPL Profiles 0.1.0-alpha.1`。

首个真正应用验证建议选择 **Tutor Profile**：数据闭环最容易测量，而且能最快证明 PPL 已经从角色扮演扩展成“长期行为程序”。
