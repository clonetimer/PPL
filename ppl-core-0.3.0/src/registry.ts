import { SemanticTypeIR } from "./types.js";

const zh = (label: string, definition: string, very_low: string, low: string, medium: string, high: string, very_high: string) => ({
  zh_CN: { label, definition, descriptors: { very_low, low, medium, high, very_high } }
});

export const STANDARD_REGISTRY_ID = "ppl.std";
export const STANDARD_REGISTRY_VERSION = "0.3.0";

export const standardSemanticRegistry: Record<string, SemanticTypeIR> = {
  "std.trait.emotional_guard": {
    id: "std.trait.emotional_guard", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 85,
    locales: zh("情感防线", "角色保护、隐藏和压制私人情绪，避免暴露真实脆弱面的稳定倾向。", "几乎不主动隐藏真实感受。", "愿意向信任对象显露真实感受与脆弱。", "会控制私人感受，但并不完全封闭。", "通常会隐藏疲惫和私人情绪。", "高度保护私人情绪，极少允许别人看见自己的脆弱面。")
  },
  "std.trait.warmth": {
    id: "std.trait.warmth", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 70,
    locales: zh("温和度", "角色在人际互动中表达善意、柔和与关照的稳定倾向。", "很少主动表达温和与关照。", "整体偏克制和疏离。", "会根据关系与场景适度表达善意。", "通常待人温和并主动顾及感受。", "高度温和，善意和关照是显著的人格底色。")
  },
  "std.trait.assertiveness": {
    id: "std.trait.assertiveness", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 62,
    locales: zh("主动坚定度", "角色主动表达立场、设置边界并推动事情前进的倾向。", "很少主动表达立场。", "通常较被动。", "能在必要时表达立场。", "通常主动且坚定。", "高度主动，立场与边界表达非常明确。")
  },
  "std.trait.playfulness": {
    id: "std.trait.playfulness", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 50,
    locales: zh("活泼程度", "角色采用嬉闹、玩笑、轻松互动的稳定倾向。", "几乎不嬉闹。", "整体克制，很少主动打闹。", "在安全关系中偶尔轻松玩笑。", "经常以轻松、嬉闹方式互动。", "高度活泼，嬉闹和玩笑是主要表达方式。")
  },
  "std.trait.vulnerability": {
    id: "std.trait.vulnerability", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 70,
    locales: zh("脆弱暴露", "角色允许他人看到疲惫、不安、需要和脆弱面的倾向。", "几乎不承认自己的需要。", "很少暴露疲惫和不安。", "在安全时可有限承认脆弱。", "比较愿意向信任对象承认需要与不安。", "会直接寻求安慰、陪伴并表达脆弱。")
  },
  "std.trait.decisiveness": {
    id: "std.trait.decisiveness", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 65,
    locales: zh("果断度", "角色在不确定条件下形成决定并采取行动的倾向。", "常回避作决定。", "决策较慢且谨慎。", "能在普通条件下正常决策。", "多数情况下果断推进。", "面对高压也能迅速做出明确决定。")
  },
  "std.trait.perseverance": {
    id: "std.trait.perseverance", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 66,
    locales: zh("坚韧度", "角色在压力、失败和长期阻力下持续行动的倾向。", "容易在阻力前放弃。", "持续性较弱。", "面对普通阻力能维持行动。", "在明显压力下仍能坚持。", "面对极端压力仍表现出非常强的持续性。")
  },
  "std.trait.self_sacrifice": {
    id: "std.trait.self_sacrifice", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 72,
    locales: zh("自我牺牲倾向", "角色将自身利益、舒适或安全置于重要对象或目标之后的倾向。", "通常优先保护自身利益与安全。", "较少主动牺牲自身。", "会依据价值权衡自身与他人。", "常愿意承担额外代价保护重要目标。", "极易将自身需求与安全放到最后。")
  },
  "std.trait.guardian_instinct": {
    id: "std.trait.guardian_instinct", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 76,
    locales: zh("守护本能", "角色主动注意、保护和挡在重要对象前面的稳定倾向。", "很少主动承担保护角色。", "保护倾向较弱。", "在必要时会保护重要对象。", "具有明显而稳定的保护倾向。", "保护重要对象几乎已经成为本能反应。")
  },
  "std.trait.jealousy": {
    id: "std.trait.jealousy", kind: "trait", primitive: "Float01", scale: "standard5", renderPriority: 45,
    locales: zh("嫉妒敏感度", "角色对重要关系中的排他性、比较和竞争线索产生嫉妒反应的倾向。", "几乎不受排他线索影响。", "嫉妒反应较弱。", "在明显关系威胁时可能产生嫉妒。", "对关系竞争较敏感。", "高度敏感于重要关系中的排他与竞争线索。")
  },
  "std.value.priority": {
    id: "std.value.priority", kind: "value", primitive: "Float01", scale: "standard5", renderPriority: 60,
    locales: zh("价值优先级", "某一价值在角色决策中的相对重要程度。", "几乎不参与决策。", "通常是次要考虑。", "属于普通权衡因素。", "属于重要决策因素。", "属于最高优先级价值之一。")
  },
  "std.preference.affinity": {
    id: "std.preference.affinity", kind: "preference", primitive: "Float01", scale: "standard5", renderPriority: 25,
    locales: zh("偏好强度", "角色对某一对象、食物、活动或审美对象的偏好程度。", "明显不偏好。", "偏好较弱。", "态度中性或普通偏好。", "明显喜欢。", "非常强烈地偏好。")
  },
  "std.relationship.trust": {
    id: "std.relationship.trust", kind: "relationship", primitive: "Float01", scale: "standard5", renderPriority: 80,
    locales: zh("信任", "角色对关系对象可靠性与安全性的主观信任程度。", "几乎不信任。", "信任较低。", "存在有限信任。", "高度信任。", "几乎完全信任。")
  },
  "std.relationship.attachment": {
    id: "std.relationship.attachment", kind: "relationship", primitive: "Float01", scale: "standard5", renderPriority: 70,
    locales: zh("依恋", "角色对关系对象的情感连接与留恋程度。", "几乎没有依恋。", "依恋较弱。", "存在稳定情感连接。", "具有明显依恋。", "具有非常强的情感依恋。")
  },
  "std.relationship.familiarity": {
    id: "std.relationship.familiarity", kind: "relationship", primitive: "Float01", scale: "standard5", renderPriority: 45,
    locales: zh("熟悉度", "角色对关系对象习惯、反应和私人信息的熟悉程度。", "几乎陌生。", "只知道少量信息。", "具有普通熟悉程度。", "相当熟悉对方。", "对对方习惯与反应非常熟悉。")
  },
  "std.relationship.dependence": {
    id: "std.relationship.dependence", kind: "relationship", primitive: "Float01", scale: "standard5", renderPriority: 55,
    locales: zh("依赖度", "角色在情感、行动或安全感上依赖关系对象的程度。", "几乎不依赖。", "依赖较低。", "存在有限依赖。", "具有明显依赖。", "高度依赖关系对象提供稳定与支持。")
  },
  "std.relationship.cooperation": {
    id: "std.relationship.cooperation", kind: "relationship", primitive: "Float01", scale: "standard5", renderPriority: 55,
    locales: zh("合作倾向", "角色在合理请求与共同目标上配合关系对象的倾向。", "很少愿意配合。", "配合程度较低。", "一般情况下可以合作。", "通常高度愿意配合。", "在合理范围内几乎总是优先合作。")
  },
  "std.state.fatigue": {
    id: "std.state.fatigue", kind: "state", primitive: "Float01", scale: "standard5", renderPriority: 80,
    locales: zh("疲劳", "角色当前身体或精神疲劳程度。", "精力非常充足。", "只有轻微疲劳。", "存在明显但可控的疲劳。", "已经较为疲惫。", "处于高度疲劳状态。")
  },
  "std.state.anxiety": {
    id: "std.state.anxiety", kind: "state", primitive: "Float01", scale: "standard5", renderPriority: 72,
    locales: zh("焦虑", "角色当前焦虑与紧张程度。", "非常平静。", "轻微紧张。", "存在中等焦虑。", "焦虑明显。", "处于高度焦虑状态。")
  },
  "std.state.embarrassment": {
    id: "std.state.embarrassment", kind: "state", primitive: "Float01", scale: "standard5", renderPriority: 58,
    locales: zh("羞赧", "角色当前因被关注、亲密或社交暴露而产生的羞赧程度。", "几乎没有羞赧。", "略有不自在。", "存在明显但可控的羞赧。", "羞赧明显。", "高度羞赧，容易明显影响表达。")
  },
  "std.state.grief": {
    id: "std.state.grief", kind: "state", primitive: "Float01", scale: "standard5", renderPriority: 70,
    locales: zh("悲伤", "角色当前悲伤与失落程度。", "几乎没有悲伤。", "轻微失落。", "存在中等悲伤。", "悲伤明显。", "处于强烈悲伤状态。")
  },
  "std.state.anger": {
    id: "std.state.anger", kind: "state", primitive: "Float01", scale: "standard5", renderPriority: 68,
    locales: zh("愤怒", "角色当前愤怒与敌意唤起程度。", "非常平静。", "略有不满。", "存在明显不满。", "愤怒明显。", "处于强烈愤怒状态。")
  },
  "std.state.alertness": {
    id: "std.state.alertness", kind: "state", primitive: "Float01", scale: "standard5", renderPriority: 78,
    locales: zh("警戒", "角色当前注意威胁、环境变化和异常线索的程度。", "非常放松。", "警戒较低。", "保持普通注意。", "处于明显警戒状态。", "高度警戒，持续监测潜在威胁。")
  },
  "std.style.formality": {
    id: "std.style.formality", kind: "style", primitive: "Float01", scale: "standard5", renderPriority: 75,
    locales: zh("正式程度", "角色当前语言表达的正式、礼仪化程度。", "非常随意。", "较为随意自然。", "正式与自然表达平衡。", "表达较正式且重视分寸。", "高度正式、礼仪化且克制。")
  },
  "std.style.verbosity": {
    id: "std.style.verbosity", kind: "style", primitive: "Float01", scale: "standard5", renderPriority: 55,
    locales: zh("话语长度", "角色当前倾向使用简短或展开表达的程度。", "极为简短。", "整体简洁。", "长度适中。", "通常会较完整地展开表达。", "倾向详细、长篇地表达。")
  },
  "std.style.emotional_explicitness": {
    id: "std.style.emotional_explicitness", kind: "style", primitive: "Float01", scale: "standard5", renderPriority: 65,
    locales: zh("情感直白度", "角色在语言中直接说出感情与需要的程度。", "几乎不直接说出感情。", "通常含蓄表达。", "会在适当场景直接表达部分情感。", "经常直接表达感情与需要。", "高度直接地表达情绪、感情与需要。")
  },
  "std.style.action_description": {
    id: "std.style.action_description", kind: "style", primitive: "Float01", scale: "standard5", renderPriority: 40,
    locales: zh("动作描写量", "回复中加入角色动作、神态和肢体细节的倾向。", "几乎不加入动作描写。", "只加入少量动作。", "适量使用动作描写。", "经常使用动作与神态描写。", "高度依赖动作和神态细节表现角色。")
  },
  "std.behavior.intensity": {
    id: "std.behavior.intensity", kind: "behavior", primitive: "Float01", scale: "standard5", renderPriority: 50,
    locales: zh("行为强度", "行为模式被表达时的相对强度。", "几乎不可见。", "较轻微。", "中等程度。", "表现明显。", "表现非常强烈。")
  },
  "std.context.danger": {
    id: "std.context.danger", kind: "context", primitive: "Float01", scale: "standard5", renderPriority: 90,
    locales: zh("危险度", "当前场景中的危险与威胁程度。", "基本安全。", "存在轻微风险。", "存在需要留意的风险。", "危险明显。", "处于高度危险状态。")
  }
};
