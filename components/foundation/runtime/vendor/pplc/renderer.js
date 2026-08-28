import { semanticBand } from "./runtime.js";
function descriptor(ir, path, band, locale = "zh_CN") {
    const binding = ir.semanticBindings[path];
    if (!binding)
        return { priority: 0 };
    const local = binding.localDescriptors?.[locale];
    const sem = binding.semanticType ? ir.semanticClosure.types[binding.semanticType] : undefined;
    const stdLocale = sem?.locales[locale];
    return {
        label: local?.label ?? stdLocale?.label,
        text: local?.descriptors?.[band] ?? stdLocale?.descriptors?.[band],
        priority: local?.priority ?? binding.renderPriority
    };
}
function identityLines(ir) {
    const i = ir.identity;
    const parts = [];
    if (i.name)
        parts.push(`你扮演${i.name}。`);
    if (i.codename)
        parts.push(`代号“${i.codename}”。`);
    const facts = [["species", "种族"], ["faction", "所属"], ["title", "身份"], ["class", "职阶"]];
    for (const [k, label] of facts)
        if (i[k])
            parts.push(`${label}：${i[k]}。`);
    return parts;
}
function privacyZh(v) {
    const m = { public: "公开", semi_private: "半私密", private: "私密", absolute: "完全私密" };
    return typeof v === "string" ? (m[v] ?? v) : String(v ?? "未知");
}
function staticSemantic(ir, resolution, profile) {
    const rows = [];
    for (const [path, binding] of Object.entries(ir.semanticBindings)) {
        if (!path.startsWith("traits."))
            continue;
        const base = resolution.trace[path]?.base ?? resolution.resolvedFlat[path];
        if (typeof base !== "number")
            continue;
        const band = resolution.trace[path]?.baseBand ?? semanticBand(base);
        const d = descriptor(ir, path, band);
        if (d.text)
            rows.push({ priority: d.priority, text: `${d.label ? d.label + "：" : ""}${d.text}` });
    }
    rows.sort((a, b) => b.priority - a.priority);
    return rows.slice(0, profile === "compact" ? 3 : profile === "full" ? 12 : 7).map(x => x.text);
}
export function render(ir, resolution, profile = "standard") {
    const staticParts = ["[ROLE]", ...identityLines(ir)];
    const core = staticSemantic(ir, resolution, profile);
    if (core.length)
        staticParts.push("", "[CORE PERSONALITY]", ...core);
    const guides = ir.invariants.flatMap(i => i.guides);
    if (guides.length)
        staticParts.push("", "[CORE CONTINUITY]", ...guides);
    if ((profile === "full" || profile === "debug") && ir.notes.length)
        staticParts.push("", "[SEMANTIC TEXTURE]", ...ir.notes.map(n => n.text.trim()));
    if (profile === "full" && ir.examples.length)
        staticParts.push("", "[REFERENCE EXAMPLES]", ...ir.examples.slice(0, 4).map(e => e.output.trim()));
    const dynamic = ["[CURRENT CONTEXT]"];
    const ctx = resolution.resolved.context;
    if (ctx.privacy !== undefined)
        dynamic.push(`当前环境：${privacyZh(ctx.privacy)}。`);
    if (ctx.outsiders_present !== undefined)
        dynamic.push(ctx.outsiders_present ? "当前有其他人在场。" : "当前没有其他人在场。");
    if (typeof ctx.danger === "number")
        dynamic.push(ctx.danger >= 0.6 ? "当前存在明显危险。" : "当前没有明显危险。");
    const rel = resolution.resolved.relationships;
    if (rel.admin) {
        dynamic.push("", "[CURRENT RELATIONSHIP]");
        if (rel.admin.stage)
            dynamic.push(`与管理员的关系阶段：${rel.admin.stage}。`);
        if (typeof rel.admin.trust === "number" && rel.admin.trust >= 0.8)
            dynamic.push("对管理员具有很高的信任。");
        if (typeof rel.admin.attachment === "number" && rel.admin.attachment >= 0.8)
            dynamic.push("对管理员具有明显而稳定的情感依恋。");
    }
    const stateLines = [];
    for (const [path, binding] of Object.entries(ir.semanticBindings)) {
        if (!path.startsWith("state."))
            continue;
        const v = resolution.resolvedFlat[path];
        if (typeof v !== "number")
            continue;
        const d = descriptor(ir, path, semanticBand(v));
        if (d.text)
            stateLines.push({ score: d.priority, text: `${d.label ?? path}：${d.text}` });
    }
    stateLines.sort((a, b) => b.score - a.score);
    if (stateLines.length)
        dynamic.push("", "[CURRENT STATE]", ...stateLines.slice(0, profile === "compact" ? 2 : 5).map(x => x.text));
    const changes = [];
    for (const [path, tr] of Object.entries(resolution.trace)) {
        if (typeof tr.final !== "number" || !tr.finalBand || tr.delta === undefined || tr.deltaMagnitude === "stable")
            continue;
        const d = descriptor(ir, path, tr.finalBand);
        if (!d.text)
            continue;
        const boost = tr.deltaMagnitude === "strong" ? 40 : tr.deltaMagnitude === "clear" ? 25 : 10;
        const direction = tr.delta < 0 ? "降低" : "提高";
        changes.push({ score: d.priority + boost, text: `相较平时，${d.label ?? path}当前${tr.deltaMagnitude === "strong" ? "显著" : tr.deltaMagnitude === "clear" ? "明显" : "略有"}${direction}。${d.text}` });
    }
    changes.sort((a, b) => b.score - a.score);
    if (changes.length)
        dynamic.push("", "[CURRENT PERSONALITY RESOLUTION]", ...changes.slice(0, profile === "compact" ? 3 : 7).map(x => x.text));
    const behaviorChanges = [];
    for (const [name, b] of Object.entries(resolution.resolved.behaviors)) {
        const enabledPath = `behaviors.${name}.enabled`;
        if (!resolution.trace[enabledPath])
            continue;
        const desc = b.description ?? ir.base.behaviors[name]?.description;
        if (b.enabled === true)
            behaviorChanges.push(desc ? `允许：${desc}` : `启用行为：${name}。`);
        else
            behaviorChanges.push(desc ? `当前不表现：${desc}` : `禁用行为：${name}。`);
    }
    if (behaviorChanges.length)
        dynamic.push("", "[ACTIVE BEHAVIOR]", ...behaviorChanges);
    const style = resolution.resolved.style;
    const styleLines = [];
    if (typeof style.formality === "number")
        styleLines.push(style.formality >= 0.8 ? "表达保持高度正式和有分寸。" : style.formality >= 0.6 ? "语气较正式、稳重。" : style.formality >= 0.4 ? "语气自然，但仍保留基本分寸。" : "语气可以明显放松和自然。");
    if (typeof style.verbosity === "number")
        styleLines.push(style.verbosity < 0.4 ? "表达保持简洁。" : style.verbosity > 0.7 ? "允许较完整地展开表达。" : "表达长度适中。");
    if (typeof style.emotional_explicitness === "number")
        styleLines.push(style.emotional_explicitness < 0.4 ? "感情表达仍偏含蓄。" : "可以更直接地表达真实感情。");
    if (styleLines.length)
        dynamic.push("", "[STYLE]", ...styleLines);
    if (resolution.pendingTransitions.length)
        dynamic.push("", "[RUNTIME NOTE]", "本轮结束后存在关系/状态转移候选；当前回复仍以本轮冻结状态为准。");
    if (profile === "debug") {
        dynamic.push("", "[DEBUG ACTIVE RULES]", ...resolution.activeRules.map(r => `[P${r.priority}] ${r.id}`));
        if (resolution.activeTransitions.length)
            dynamic.push("", "[DEBUG TRANSITIONS]", ...resolution.activeTransitions.map(t => `${t.id}: ${t.target} -> ${JSON.stringify(t.to)}`));
    }
    return { staticPrompt: staticParts.join("\n"), dynamicPrompt: dynamic.join("\n"), diagnostics: resolution.diagnostics };
}
