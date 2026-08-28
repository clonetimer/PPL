import {
  DeltaMagnitude, Diagnostic, IRExpr, IRValue, PendingPatch, PendingTransition, PplEvent, Resolution,
  ResolutionTrace, RuntimeStateInput, SemanticBand, SourceTestResult, SourceTestRun, StaticPersonaIR
} from "./types.js";

const relationshipOrder = ["stranger", "acquaintance", "colleague", "trusted", "close", "confession", "lover", "bonded"];
const privacyOrder = ["public", "semi_private", "private", "absolute"];
const normNum = (n: number) => Math.round((n + Number.EPSILON) * 1e12) / 1e12;

export function flatten(obj: unknown, prefix = "", out: Record<string, IRValue> = {}): Record<string, IRValue> {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) out[prefix] = obj as IRValue;
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
    else out[path] = v as IRValue;
  }
  return out;
}
export function unflatten(flat: Record<string, IRValue>, prefix: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [path, value] of Object.entries(flat)) {
    if (!path.startsWith(prefix + ".")) continue;
    const parts = path.slice(prefix.length + 1).split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] ??= {};
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}
function rank(v: IRValue): number | undefined {
  if (typeof v !== "string") return undefined;
  const r = relationshipOrder.indexOf(v); if (r >= 0) return r;
  const p = privacyOrder.indexOf(v); if (p >= 0) return p;
  return undefined;
}
export function evaluateExpression(expr: IRExpr, env: Record<string, IRValue>): IRValue {
  if (expr.kind === "literal") return expr.value;
  if (expr.kind === "path") return env[expr.path];
  if (expr.kind === "unary") return !Boolean(evaluateExpression(expr.operand, env));
  const l = evaluateExpression(expr.left, env), r = evaluateExpression(expr.right, env);
  if (expr.operator === "and") return Boolean(l) && Boolean(r);
  if (expr.operator === "or") return Boolean(l) || Boolean(r);
  if (expr.operator === "==") return l === r;
  if (expr.operator === "!=") return l !== r;
  const lr = rank(l), rr = rank(r);
  const a: any = lr !== undefined && rr !== undefined ? lr : l;
  const b: any = lr !== undefined && rr !== undefined ? rr : r;
  if (expr.operator === ">") return a > b;
  if (expr.operator === "<") return a < b;
  if (expr.operator === ">=") return a >= b;
  if (expr.operator === "<=") return a <= b;
  return false;
}
export function semanticBand(v: number): SemanticBand {
  if (v < 0.20) return "very_low";
  if (v < 0.40) return "low";
  if (v < 0.60) return "medium";
  if (v < 0.80) return "high";
  return "very_high";
}
export function deltaMagnitude(delta: number): DeltaMagnitude {
  const d = Math.abs(delta);
  if (d < 0.10) return "stable";
  if (d < 0.25) return "slight";
  if (d < 0.45) return "clear";
  return "strong";
}
function clampForPath(ir: StaticPersonaIR, path: string, value: IRValue): IRValue {
  if (ir.symbols[path]?.primitive === "Float01" && typeof value === "number") return normNum(Math.max(0, Math.min(1, value)));
  if (typeof value === "number") return normNum(value);
  return value;
}
export function buildSnapshot(ir: StaticPersonaIR, runtime: RuntimeStateInput = {}, context: Record<string, unknown> = {}, event: PplEvent = {}): Record<string, IRValue> {
  const out: Record<string, IRValue> = {};
  Object.assign(out, flatten(ir.identity, "identity"));
  Object.assign(out, flatten(ir.meta, "meta"));
  Object.assign(out, flatten(ir.base.traits, "traits"));
  Object.assign(out, flatten(ir.base.values, "values"));
  Object.assign(out, flatten(ir.base.preferences, "preferences"));
  Object.assign(out, flatten(ir.base.style, "style"));
  Object.assign(out, flatten(ir.base.behaviors, "behaviors"));
  Object.assign(out, flatten(ir.runtimeInitial.relationships, "relationships"));
  Object.assign(out, flatten(ir.runtimeInitial.state, "state"));
  Object.assign(out, flatten(ir.contextDefaults, "context"));
  if (runtime.relationships) Object.assign(out, flatten(runtime.relationships, "relationships"));
  if (runtime.state) Object.assign(out, flatten(runtime.state, "state"));
  Object.assign(out, flatten(context, "context"));
  Object.assign(out, flatten(event, "event"));
  return out;
}

function applyEffects(ir: StaticPersonaIR, snapshot: Record<string, IRValue>, active: StaticPersonaIR["rules"], diagnostics: Diagnostic[]) {
  const resolved = { ...snapshot };
  const trace: Record<string, ResolutionTrace> = {};
  const ensureTrace = (path: string) => trace[path] ??= {
    path,
    base: snapshot[path],
    baseBand: typeof snapshot[path] === "number" && ir.symbols[path]?.primitive === "Float01" ? semanticBand(snapshot[path] as number) : undefined,
    steps: [], raw: snapshot[path], final: snapshot[path]
  };
  const buckets = new Map<string, Map<number, { rule: typeof active[number]; effect: typeof active[number]["effects"][number] }[]>>();
  for (const rule of active) for (const effect of rule.effects) {
    let byPriority = buckets.get(effect.path); if (!byPriority) buckets.set(effect.path, byPriority = new Map());
    let arr = byPriority.get(rule.priority); if (!arr) byPriority.set(rule.priority, arr = []);
    arr.push({ rule, effect });
  }
  for (const [path, byPriority] of buckets) {
    const tr = ensureTrace(path);
    let current = resolved[path];
    for (const p of [...byPriority.keys()].sort((a, b) => a - b)) {
      const items = byPriority.get(p)!.sort((a, b) => a.rule.id.localeCompare(b.rule.id));
      const sets = items.filter(x => ["set", "enable", "disable"].includes(x.effect.op));
      const additives = items.filter(x => x.effect.op === "add" || x.effect.op === "sub");
      if (sets.length && additives.length) {
        diagnostics.push({ code: "PPL-E412", severity: "error", message: `Mixed SET and additive effects for '${path}' at priority ${p}.` });
        continue;
      }
      if (sets.length) {
        const values = sets.map(x => x.effect.op === "enable" ? true : x.effect.op === "disable" ? false : evaluateExpression(x.effect.value!, snapshot));
        const uniq = [...new Set(values.map(v => JSON.stringify(v)))];
        if (uniq.length > 1) {
          diagnostics.push({ code: path.endsWith(".enabled") ? "PPL-E413" : "PPL-E411", severity: "error", message: `Conflicting SET effects for '${path}' at priority ${p}.` });
          continue;
        }
        const item = sets[0]; const before = current; current = values[0] as IRValue;
        tr.steps.push({ rule: item.rule.id, priority: p, op: item.effect.op, value: current, before, after: current });
      } else {
        const beforeBucket = current;
        let delta = 0;
        for (const item of additives) {
          const v = evaluateExpression(item.effect.value!, snapshot);
          if (typeof v !== "number" || typeof current !== "number") {
            diagnostics.push({ code: "PPL-E421", severity: "error", message: `Add/sub effect on '${path}' requires numeric values.` });
            continue;
          }
          delta += item.effect.op === "add" ? v : -v;
        }
        current = typeof beforeBucket === "number" ? normNum(beforeBucket + delta) : beforeBucket;
        let rolling = beforeBucket;
        for (const item of additives) {
          const v = evaluateExpression(item.effect.value!, snapshot);
          if (typeof v !== "number" || typeof rolling !== "number") continue;
          const after = normNum(rolling + (item.effect.op === "add" ? v : -v));
          tr.steps.push({ rule: item.rule.id, priority: p, op: item.effect.op, value: v, before: rolling, after });
          rolling = after;
        }
      }
      resolved[path] = current as IRValue;
    }
    tr.raw = current;
    const final = clampForPath(ir, path, current as IRValue);
    resolved[path] = final;
    tr.final = final;
    if (typeof final === "number" && ir.symbols[path]?.primitive === "Float01") {
      tr.finalBand = semanticBand(final);
      if (typeof tr.base === "number") { tr.delta = normNum(final - tr.base); tr.deltaMagnitude = deltaMagnitude(tr.delta); }
    }
  }
  return { resolved, trace };
}

function resolveCommits(ir: StaticPersonaIR, snapshot: Record<string, IRValue>, active: StaticPersonaIR["rules"], diagnostics: Diagnostic[]): PendingPatch[] {
  const byPath = new Map<string, { rule: typeof active[number]; commit: typeof active[number]["commits"][number] }[]>();
  for (const rule of active) for (const commit of rule.commits) {
    let arr = byPath.get(commit.path); if (!arr) byPath.set(commit.path, arr = []);
    arr.push({ rule, commit });
  }
  const patches: PendingPatch[] = [];
  for (const [path, entries] of byPath) {
    let current = snapshot[path];
    const priorities = [...new Set(entries.map(x => x.rule.priority))].sort((a, b) => a - b);
    for (const p of priorities) {
      const bucket = entries.filter(x => x.rule.priority === p).sort((a, b) => a.rule.id.localeCompare(b.rule.id));
      const sets = bucket.filter(x => x.commit.op === "set");
      const additives = bucket.filter(x => x.commit.op === "add" || x.commit.op === "sub");
      if (sets.length && additives.length) { diagnostics.push({ code: "PPL-E534", severity: "error", message: `Mixed SET and additive commits for '${path}' at priority ${p}.` }); continue; }
      if (sets.length) {
        const vals = sets.map(x => evaluateExpression(x.commit.value, snapshot));
        if (new Set(vals.map(v => JSON.stringify(v))).size > 1) { diagnostics.push({ code: "PPL-E535", severity: "error", message: `Conflicting SET commits for '${path}' at priority ${p}.` }); continue; }
        const from = current; current = clampForPath(ir, path, vals[0]);
        patches.push({ source: sets.map(x => x.rule.id).join("+"), op: "set", path, value: vals[0], from, projected: current });
      } else {
        for (const item of additives) {
          const v = evaluateExpression(item.commit.value, snapshot);
          const from = current;
          if (typeof from !== "number" || typeof v !== "number") {
            diagnostics.push({ code: "PPL-E531", severity: "error", message: `Commit '${item.commit.op}' for '${path}' requires numeric values.` });
            continue;
          }
          current = clampForPath(ir, path, normNum(item.commit.op === "add" ? from + v : from - v));
          patches.push({ source: item.rule.id, op: item.commit.op, path, value: v, from, projected: current });
        }
      }
    }
  }
  return patches;
}

function resolveTransitions(ir: StaticPersonaIR, snapshot: Record<string, IRValue>, pendingCommits: PendingPatch[], diagnostics: Diagnostic[]) {
  const eligible = ir.transitions.filter(t => t.from.some(v => v === snapshot[t.target]) && Boolean(evaluateExpression(t.condition, snapshot))).sort((a, b) => a.id.localeCompare(b.id));
  const byTarget = new Map<string, typeof eligible>();
  for (const t of eligible) { let arr = byTarget.get(t.target); if (!arr) byTarget.set(t.target, arr = []); arr.push(t); }
  const pendingTransitions: PendingTransition[] = [];
  const activeTransitions: { id: string; target: string; to: IRValue }[] = [];
  for (const [target, list] of byTarget) {
    if (pendingCommits.some(c => c.path === target)) {
      diagnostics.push({ code: "PPL-E532", severity: "error", message: `Transition/commit conflict on '${target}'.` });
      continue;
    }
    const tos = new Set(list.map(t => JSON.stringify(t.to)));
    if (tos.size > 1) {
      diagnostics.push({ code: "PPL-E533", severity: "error", message: `Multiple active transitions for '${target}' produce different target states.` });
      continue;
    }
    const selected = list[0];
    pendingTransitions.push({ source: list.map(t => t.id).join("+"), path: target, from: snapshot[target], to: selected.to });
    for (const t of list) activeTransitions.push({ id: t.id, target: t.target, to: t.to });
  }
  return { pendingTransitions, activeTransitions };
}

export function resolve(ir: StaticPersonaIR, runtime: RuntimeStateInput = {}, context: Record<string, unknown> = {}, event: PplEvent = {}): Resolution {
  const diagnostics: Diagnostic[] = [];
  const snapshot = buildSnapshot(ir, runtime, context, event);
  const active = ir.rules.filter(r => Boolean(evaluateExpression(r.condition, snapshot))).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const { resolved, trace } = applyEffects(ir, snapshot, active, diagnostics);
  const pendingCommits = resolveCommits(ir, snapshot, active, diagnostics);
  const { pendingTransitions, activeTransitions } = resolveTransitions(ir, snapshot, pendingCommits, diagnostics);
  const invariantResults = ir.invariants.map(inv => ({ id: inv.id, passed: inv.assertions.every(a => Boolean(evaluateExpression(a, resolved))), guides: inv.guides }));
  for (const x of invariantResults) if (!x.passed) diagnostics.push({ code: "PPL-R601", severity: "error", message: `Invariant '${x.id}' violated.` });

  return {
    schema: "ppl.resolution/0.3",
    activeRules: active.map(r => ({ id: r.id, priority: r.priority })),
    activeTransitions,
    resolvedFlat: resolved,
    resolved: {
      traits: unflatten(resolved, "traits"), values: unflatten(resolved, "values"),
      relationships: unflatten(resolved, "relationships"), context: unflatten(resolved, "context"),
      state: unflatten(resolved, "state"), behaviors: unflatten(resolved, "behaviors"), style: unflatten(resolved, "style")
    },
    trace, pendingCommits, pendingTransitions, invariantResults, diagnostics,
    valid: !diagnostics.some(d => d.severity === "error")
  };
}

export function applyPendingCommits(runtime: RuntimeStateInput, resolution: Resolution): RuntimeStateInput {
  const flat = { ...flatten(runtime.relationships ?? {}, "relationships"), ...flatten(runtime.state ?? {}, "state") };
  for (const p of resolution.pendingCommits) if (p.projected !== undefined) flat[p.path] = p.projected;
  return { ...runtime, relationships: unflatten(flat, "relationships"), state: unflatten(flat, "state") };
}
export function applyResolution(runtime: RuntimeStateInput, resolution: Resolution): RuntimeStateInput {
  const afterCommits = applyPendingCommits(runtime, resolution);
  const flat = { ...flatten(afterCommits.relationships ?? {}, "relationships"), ...flatten(afterCommits.state ?? {}, "state") };
  for (const t of resolution.pendingTransitions) flat[t.path] = t.to;
  const nextTurn = (runtime.session?.turn ?? 0) + 1;
  return { ...afterCommits, session: { ...runtime.session, turn: nextTurn }, relationships: unflatten(flat, "relationships"), state: unflatten(flat, "state") };
}

function fixtureObjects(given: Record<string, IRValue>) {
  const runtimeFlat: Record<string, IRValue> = {}, contextFlat: Record<string, IRValue> = {}, eventFlat: Record<string, IRValue> = {};
  for (const [p, v] of Object.entries(given)) {
    if (p.startsWith("relationships.") || p.startsWith("state.")) runtimeFlat[p] = v;
    else if (p.startsWith("context.")) contextFlat[p] = v;
    else if (p.startsWith("event.")) eventFlat[p] = v;
  }
  return {
    runtime: { relationships: unflatten(runtimeFlat, "relationships"), state: unflatten(runtimeFlat, "state") } as RuntimeStateInput,
    context: unflatten(contextFlat, "context"),
    event: unflatten(eventFlat, "event") as PplEvent
  };
}
export function runSourceTests(ir: StaticPersonaIR): SourceTestRun {
  const results: SourceTestResult[] = [];
  for (const t of ir.tests) {
    const f = fixtureObjects(t.given);
    const resolution = resolve(ir, f.runtime, f.context, f.event);
    const failures: string[] = [];
    t.expects.forEach((expr, i) => { if (!Boolean(evaluateExpression(expr, resolution.resolvedFlat))) failures.push(`expect[${i + 1}] evaluated to false`); });
    if (!resolution.valid) failures.push(...resolution.diagnostics.filter(d => d.severity === "error").map(d => `${d.code}: ${d.message}`));
    results.push({ id: t.id, passed: failures.length === 0, failures, resolution });
  }
  return { passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
}

function deepMerge(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v != null && typeof v === "object" && !Array.isArray(v) && out[k] != null && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v as Record<string, any>);
    else out[k] = v;
  }
  return out;
}
export function mergeScene(ir: StaticPersonaIR, sceneName: string, runtime: RuntimeStateInput = {}, context: Record<string, unknown> = {}) {
  const scene = ir.scenes[sceneName];
  if (!scene) throw new Error(`Unknown scene '${sceneName}'.`);
  const runtimeState = deepMerge(scene.state, runtime.state ?? {});
  return { runtime: { ...runtime, state: runtimeState }, context: deepMerge(scene.context, context) };
}
