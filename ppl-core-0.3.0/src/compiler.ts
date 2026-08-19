import { lex } from "./lexer.js";
import { parse } from "./parser.js";
import { standardSemanticRegistry, STANDARD_REGISTRY_ID, STANDARD_REGISTRY_VERSION } from "./registry.js";
import {
  AssignmentNode, CompileOptions, CompileResult, Diagnostic, Expr, IRExpr, IRValue, ModuleDependencyIR,
  ModuleMemberNode, ModuleNode, Mutability, PersonaMemberNode, PersonaNode, PrimitiveType, ProgramNode,
  SceneNode, SemanticBindingIR, SemanticKind, SemanticTypeIR, StaticPersonaIR, SymbolIR, TopLevelNode
} from "./types.js";

const primitiveNames = new Set<PrimitiveType>(["Bool", "Int", "Float", "Float01", "String", "Symbol"]);
const semanticBands = ["very_low", "low", "medium", "high", "very_high"] as const;

interface MemberContext<T extends PersonaMemberNode | ModuleMemberNode = PersonaMemberNode | ModuleMemberNode> {
  member: T;
  origin: string;
  aliases: Record<string, string>;
  imported: boolean;
}
interface LoadedModule {
  node: ModuleNode;
  file: string;
  aliases: Record<string, string>;
}

function setNested(target: Record<string, any>, path: string[], value: IRValue) {
  let cur = target;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] ??= {};
  cur[path[path.length - 1]] = value;
}
function getNested(target: Record<string, any>, path: string[]): unknown {
  let cur: any = target;
  for (const p of path) { if (cur == null || typeof cur !== "object") return undefined; cur = cur[p]; }
  return cur;
}
function semanticKindForNamespace(ns: string): SemanticKind | undefined {
  const map: Record<string, SemanticKind> = {
    traits: "trait", values: "value", preferences: "preference", relationships: "relationship",
    context: "context", state: "state", style: "style", behaviors: "behavior"
  };
  return map[ns];
}
function mutabilityForNamespace(ns: string): Mutability {
  if (ns === "identity" || ns === "meta" || ns === "preferences") return "immutable";
  if (["traits", "values", "style", "behaviors"].includes(ns)) return "computed";
  if (["relationships", "state"].includes(ns)) return "runtime";
  if (["context", "event"].includes(ns)) return "host";
  return "immutable";
}
function inferPrimitive(path: string, assignment: AssignmentNode): PrimitiveType {
  if (assignment.typeRef && primitiveNames.has(assignment.typeRef as PrimitiveType)) return assignment.typeRef as PrimitiveType;
  const v = assignment.value.value;
  if (typeof v === "boolean") return "Bool";
  if (typeof v === "string") return assignment.value.literalKind === "String" ? "String" : "Symbol";
  if (typeof v === "number") {
    if (/^(traits|values|preferences|state|style|relationships|behaviors|context)\./.test(path) && v >= 0 && v <= 1) return "Float01";
    return Number.isInteger(v) ? "Int" : "Float";
  }
  return "String";
}
function normalizeExpr(expr: Expr): IRExpr {
  switch (expr.kind) {
    case "LiteralExpr": return { kind: "literal", value: expr.value };
    case "PathExpr": return { kind: "path", path: expr.parts.join(".") };
    case "UnaryExpr": return { kind: "unary", operator: "not", operand: normalizeExpr(expr.operand) };
    case "BinaryExpr": return { kind: "binary", operator: expr.operator, left: normalizeExpr(expr.left), right: normalizeExpr(expr.right) };
  }
}
function collectExprPaths(expr: IRExpr, out = new Set<string>()): Set<string> {
  if (expr.kind === "path") out.add(expr.path);
  else if (expr.kind === "binary") { collectExprPaths(expr.left, out); collectExprPaths(expr.right, out); }
  else if (expr.kind === "unary") collectExprPaths(expr.operand, out);
  return out;
}

function isNumericPrimitive(t: PrimitiveType | undefined): boolean { return t === "Int" || t === "Float" || t === "Float01"; }
function astExprType(expr: Expr, symbols: Record<string, SymbolIR>): PrimitiveType | undefined {
  if (expr.kind === "LiteralExpr") {
    if (expr.literalKind === "List") return undefined;
    return expr.literalKind === "Float" && typeof expr.value === "number" && expr.value >= 0 && expr.value <= 1 ? "Float" : expr.literalKind as PrimitiveType;
  }
  if (expr.kind === "PathExpr") {
    const p = expr.parts.join(".");
    if (symbols[p]) return symbols[p].primitive;
    if (p === "event.text") return "String";
    if (p.startsWith("event.")) return "Symbol";
    return undefined;
  }
  if (expr.kind === "UnaryExpr") return "Bool";
  return "Bool";
}
function compatiblePrimitive(expected: PrimitiveType | undefined, actual: PrimitiveType | undefined): boolean {
  if (!expected || !actual) return true;
  if (expected === actual) return true;
  return isNumericPrimitive(expected) && isNumericPrimitive(actual);
}
function validateAstExpr(expr: Expr, symbols: Record<string, SymbolIR>, diagnostics: Diagnostic[], range?: any): PrimitiveType | undefined {
  if (expr.kind === "LiteralExpr" || expr.kind === "PathExpr") return astExprType(expr, symbols);
  if (expr.kind === "UnaryExpr") {
    const t = validateAstExpr(expr.operand, symbols, diagnostics, range);
    if (t && t !== "Bool") diagnostics.push({ code: "PPL-E243", severity: "error", message: `Operator 'not' requires Bool, received ${t}.`, range });
    return "Bool";
  }
  const lt = validateAstExpr(expr.left, symbols, diagnostics, range);
  const rt = validateAstExpr(expr.right, symbols, diagnostics, range);
  if (expr.operator === "and" || expr.operator === "or") {
    if ((lt && lt !== "Bool") || (rt && rt !== "Bool")) diagnostics.push({ code: "PPL-E243", severity: "error", message: `Logical operator '${expr.operator}' requires Bool operands.`, range });
    return "Bool";
  }
  if (expr.operator === "==" || expr.operator === "!=") {
    if (!compatiblePrimitive(lt, rt)) diagnostics.push({ code: "PPL-E242", severity: "error", message: `Cannot compare ${lt ?? "unknown"} with ${rt ?? "unknown"}.`, range });
    return "Bool";
  }
  if (isNumericPrimitive(lt) && isNumericPrimitive(rt)) return "Bool";
  // PPL 0.3 only defines ordering for RelationshipStage and Privacy symbols.
  const orderedPath = (e: Expr) => e.kind === "PathExpr" && (e.parts.join(".") === "context.privacy" || /^relationships\.[^.]+\.stage$/.test(e.parts.join(".")));
  if (lt === "Symbol" && rt === "Symbol" && (orderedPath(expr.left) || orderedPath(expr.right))) return "Bool";
  diagnostics.push({ code: "PPL-E245", severity: "error", message: `Ordered comparison '${expr.operator}' requires numeric values or built-in ordered Symbol fields.`, range });
  return "Bool";
}
function validatePrimitive(value: IRValue, primitive: PrimitiveType): string | undefined {
  if (primitive === "Bool" && typeof value !== "boolean") return "expected Bool";
  if (["Int", "Float", "Float01"].includes(primitive) && typeof value !== "number") return `expected ${primitive}`;
  if (primitive === "Int" && typeof value === "number" && !Number.isInteger(value)) return "expected Int";
  if (primitive === "Float01" && typeof value === "number" && (value < 0 || value > 1)) return "expected Float01 in [0,1]";
  if (primitive === "String" && typeof value !== "string") return "expected String";
  if (primitive === "Symbol" && typeof value !== "string") return "expected Symbol";
  return undefined;
}
function parseSource(source: string, file: string): { ast?: ProgramNode; diagnostics: Diagnostic[] } {
  const lx = lex(source, file);
  const ps = parse(lx.tokens);
  return { ast: ps.ast, diagnostics: [...lx.diagnostics, ...ps.diagnostics] };
}
function versionSatisfies(actual: string | undefined, requested: string | undefined): boolean {
  if (!requested) return true;
  if (!actual) return false;
  if (!requested.startsWith("^")) return actual === requested;
  const req = requested.slice(1).split(".").map(x => Number(x));
  const act = actual.split("-")[0].split(".").map(x => Number(x));
  if (!Number.isFinite(req[0]) || !Number.isFinite(act[0]) || act[0] !== req[0]) return false;
  const r1 = req[1] ?? 0, r2 = req[2] ?? 0, a1 = act[1] ?? 0, a2 = act[2] ?? 0;
  return a1 > r1 || (a1 === r1 && a2 >= r2);
}
function resolveTypeRef(ref: string | undefined, aliases: Record<string, string>, origin: string, registry: Record<string, SemanticTypeIR>): string | undefined {
  if (!ref || primitiveNames.has(ref as PrimitiveType)) return ref;
  const parts = ref.split(".");
  if (aliases[parts[0]]) return [aliases[parts[0]], ...parts.slice(1)].join(".");
  if (registry[ref]) return ref;
  const local = `${origin}.${ref}`;
  if (registry[local]) return local;
  return ref;
}
function memberId(origin: string, name: string, imported: boolean): string { return imported ? `${origin}::${name}` : name; }

function semanticFromDecl(module: ModuleNode, member: Extract<ModuleMemberNode, { kind: "SemanticDecl" }>, diagnostics: Diagnostic[]): SemanticTypeIR | undefined {
  const data: Record<string, any> = {};
  for (const a of member.assignments) setNested(data, a.path, a.value.value);
  const primitive = data.primitive as PrimitiveType | undefined;
  if (!primitive || !primitiveNames.has(primitive)) {
    diagnostics.push({ code: "PPL-E254", severity: "error", message: `Semantic '${module.name}.${member.name}' must declare a valid primitive type.`, range: member.range });
    return undefined;
  }
  const scale = data.scale === "standard5" ? "standard5" : undefined;
  if (data.scale !== undefined && !scale) diagnostics.push({ code: "PPL-E255", severity: "error", message: `Semantic '${module.name}.${member.name}' uses unsupported scale '${String(data.scale)}'.`, range: member.range });
  if (scale && primitive !== "Float01") diagnostics.push({ code: "PPL-E256", severity: "error", message: `Scale standard5 requires Float01 for semantic '${module.name}.${member.name}'.`, range: member.range });
  const locales: SemanticTypeIR["locales"] = {};
  const labels = data.label ?? {};
  const definitions = data.definition ?? {};
  const descriptors = data.descriptor ?? {};
  const localeNames = new Set([...Object.keys(labels), ...Object.keys(definitions), ...Object.keys(descriptors)]);
  for (const locale of localeNames) {
    const label = labels[locale];
    if (typeof label !== "string") {
      diagnostics.push({ code: "PPL-E257", severity: "error", message: `Semantic '${module.name}.${member.name}' locale '${locale}' requires label.${locale}.`, range: member.range });
      continue;
    }
    const d: any = {};
    for (const band of semanticBands) if (typeof descriptors?.[locale]?.[band] === "string") d[band] = descriptors[locale][band];
    locales[locale] = { label, definition: typeof definitions[locale] === "string" ? definitions[locale] : undefined, descriptors: d };
  }
  if (!Object.keys(locales).length) diagnostics.push({ code: "PPL-W252", severity: "warning", message: `Semantic '${module.name}.${member.name}' has no locale descriptors.` });
  return {
    id: `${module.name}.${member.name}`,
    kind: member.semanticKind,
    primitive,
    scale,
    renderPriority: typeof data.render?.priority === "number" ? data.render.priority : 50,
    locales,
    origin: { module: module.name, version: module.version }
  };
}

function collectInlineModules(ast: ProgramNode, diagnostics: Diagnostic[]): Map<string, { node: ModuleNode; file: string }> {
  const map = new Map<string, { node: ModuleNode; file: string }>();
  for (const d of ast.declarations) if (d.kind === "Module") {
    if (map.has(d.name)) diagnostics.push({ code: "PPL-E323", severity: "error", message: `Duplicate module '${d.name}'.`, range: d.range });
    else map.set(d.name, { node: d, file: d.range.start.file });
  }
  return map;
}

function resolveModules(
  persona: PersonaNode,
  rootAst: ProgramNode,
  rootFile: string,
  options: CompileOptions,
  diagnostics: Diagnostic[]
): { modules: LoadedModule[]; dependencies: ModuleDependencyIR[]; personaAliases: Record<string, string> } {
  const inline = collectInlineModules(rootAst, diagnostics);
  const loaded = new Map<string, LoadedModule>();
  const visiting = new Set<string>();
  const dependencies: ModuleDependencyIR[] = [];
  const personaAliases: Record<string, string> = {};

  const load = (id: string, requested: string | undefined, fromFile: string): LoadedModule | undefined => {
    if (loaded.has(id)) {
      const hit = loaded.get(id)!;
      if (!versionSatisfies(hit.node.version, requested)) diagnostics.push({ code: "PPL-E304", severity: "error", message: `Module '${id}' version '${hit.node.version ?? "<none>"}' does not satisfy '${requested}'.` });
      return hit;
    }
    if (visiting.has(id)) { diagnostics.push({ code: "PPL-E303", severity: "error", message: `Import cycle detected at module '${id}'.` }); return undefined; }
    visiting.add(id);
    let node: ModuleNode | undefined;
    let file = fromFile;
    const inl = inline.get(id);
    if (inl) { node = inl.node; file = inl.file; }
    else if (options.moduleResolver) {
      const src = options.moduleResolver(id, fromFile);
      if (src) {
        file = src.file;
        const parsed = parseSource(src.source, src.file);
        diagnostics.push(...parsed.diagnostics);
        const matches = parsed.ast?.declarations.filter((d): d is ModuleNode => d.kind === "Module" && d.name === id) ?? [];
        if (matches.length !== 1) diagnostics.push({ code: "PPL-E302", severity: "error", message: `Module source '${src.file}' must declare exactly one module named '${id}'.` });
        else node = matches[0];
      }
    }
    if (!node) { diagnostics.push({ code: "PPL-E301", severity: "error", message: `Unable to resolve module '${id}' imported from '${fromFile}'.` }); visiting.delete(id); return undefined; }
    if (!versionSatisfies(node.version, requested)) diagnostics.push({ code: "PPL-E304", severity: "error", message: `Module '${id}' version '${node.version ?? "<none>"}' does not satisfy '${requested}'.`, range: node.range });

    const aliases: Record<string, string> = {};
    for (const m of node.members) if (m.kind === "Import") {
      const dep = load(m.module, m.version, file);
      if (m.alias) aliases[m.alias] = m.module;
      if (dep) dependencies.push({ id: m.module, version: dep.node.version, alias: m.alias, file: dep.file });
    }
    const item = { node, file, aliases };
    loaded.set(id, item);
    visiting.delete(id);
    return item;
  };

  for (const m of persona.members) if (m.kind === "Import") {
    const dep = load(m.module, m.version, rootFile);
    if (m.alias) personaAliases[m.alias] = m.module;
    if (dep) dependencies.push({ id: m.module, version: dep.node.version, alias: m.alias, file: dep.file });
  }
  // dependencies first, deterministic lexical module order for composition; source order has no overwrite semantics.
  return { modules: [...loaded.values()].sort((a, b) => a.node.name.localeCompare(b.node.name)), dependencies: dedupeDependencies(dependencies), personaAliases };
}
function dedupeDependencies(items: ModuleDependencyIR[]): ModuleDependencyIR[] {
  const m = new Map<string, ModuleDependencyIR>();
  for (const x of items) m.set(`${x.id}|${x.alias ?? ""}`, x);
  return [...m.values()].sort((a, b) => a.id.localeCompare(b.id) || (a.alias ?? "").localeCompare(b.alias ?? ""));
}

function compileProgram(ast: ProgramNode, file: string, options: CompileOptions, diagnostics: Diagnostic[]): StaticPersonaIR | undefined {
  const personas = ast.declarations.filter((d): d is PersonaNode => d.kind === "Persona");
  if (personas.length !== 1) {
    diagnostics.push({ code: "PPL-E120", severity: "error", message: `Compilation unit must contain exactly one persona; found ${personas.length}.` });
    return undefined;
  }
  const persona = personas[0];
  const { modules, dependencies, personaAliases } = resolveModules(persona, ast, file, options, diagnostics);
  if (diagnostics.some(d => d.severity === "error")) return undefined;

  const registry: Record<string, SemanticTypeIR> = { ...standardSemanticRegistry };
  const registries: Record<string, string> = { [STANDARD_REGISTRY_ID]: STANDARD_REGISTRY_VERSION };
  for (const mod of modules) {
    registries[mod.node.name] = mod.node.version ?? "0.0.0";
    for (const m of mod.node.members) if (m.kind === "SemanticDecl") {
      const sem = semanticFromDecl(mod.node, m, diagnostics);
      if (!sem) continue;
      if (registry[sem.id]) diagnostics.push({ code: "PPL-E323", severity: "error", message: `Duplicate semantic type '${sem.id}'.`, range: m.range });
      else registry[sem.id] = sem;
    }
  }

  const ir: StaticPersonaIR = {
    schema: "ppl.persona-ir/0.3",
    persona: { id: persona.name, version: persona.version },
    meta: {}, identity: {},
    base: { traits: {}, values: {}, preferences: {}, style: {}, behaviors: {} },
    contextDefaults: {}, runtimeInitial: { relationships: {}, state: {} }, scenes: {},
    symbols: {}, rules: [], transitions: [], invariants: [], notes: [], examples: [], tests: [],
    dependencies, semanticBindings: {}, semanticClosure: { registries, types: {} }, diagnostics
  };

  const contexts: MemberContext[] = [];
  for (const mod of modules) for (const member of mod.node.members) {
    if (member.kind !== "Import" && member.kind !== "SemanticDecl") contexts.push({ member, origin: mod.node.name, aliases: mod.aliases, imported: true });
  }
  for (const member of persona.members) if (member.kind !== "Import") contexts.push({ member, origin: persona.name, aliases: personaAliases, imported: false });

  const registerAssignment = (canonical: string, assignment: AssignmentNode, sink: Record<string, any>, sinkPath: string[], ctx: MemberContext) => {
    if (ir.symbols[canonical]) {
      diagnostics.push({ code: "PPL-E321", severity: "error", message: `Duplicate declaration for '${canonical}' from '${ctx.origin}'.`, range: assignment.range });
      return;
    }
    let semanticType: string | undefined;
    let primitive: PrimitiveType;
    const resolvedType = resolveTypeRef(assignment.typeRef, ctx.aliases, ctx.origin, registry);
    if (resolvedType && !primitiveNames.has(resolvedType as PrimitiveType)) {
      semanticType = resolvedType;
      const sem = registry[semanticType];
      if (!sem) {
        diagnostics.push({ code: "PPL-E252", severity: "error", message: `Unknown semantic type '${semanticType}'.`, range: assignment.range });
        primitive = inferPrimitive(canonical, assignment);
      } else {
        primitive = sem.primitive;
        const expectedKind = semanticKindForNamespace(canonical.split(".")[0]);
        if (expectedKind && sem.kind !== expectedKind) diagnostics.push({ code: "PPL-E251", severity: "error", message: `Semantic kind mismatch: '${semanticType}' is ${sem.kind}, cannot bind to ${expectedKind} field '${canonical}'.`, range: assignment.range });
        ir.semanticClosure.types[semanticType] = sem;
      }
    } else if (resolvedType && primitiveNames.has(resolvedType as PrimitiveType)) primitive = resolvedType as PrimitiveType;
    else primitive = inferPrimitive(canonical, assignment);

    const problem = validatePrimitive(assignment.value.value, primitive);
    if (problem) diagnostics.push({ code: "PPL-E253", severity: "error", message: `Invalid value for '${canonical}': ${problem}.`, range: assignment.range });
    setNested(sink, sinkPath, assignment.value.value);
    const symbol: SymbolIR = { path: canonical, primitive, mutability: mutabilityForNamespace(canonical.split(".")[0]), semanticType, provenance: ctx.origin };
    ir.symbols[canonical] = symbol;
    if (semanticType) {
      const sem = registry[semanticType];
      const binding: SemanticBindingIR = { path: canonical, primitive, semanticType, renderPriority: sem?.renderPriority ?? 50 };
      ir.semanticBindings[canonical] = binding;
    }
  };

  // Pass 1: declarations create the full symbol table before rules are checked.
  for (const ctx of contexts) {
    const member = ctx.member;
    if (member.kind === "SimpleBlock") {
      for (const a of member.assignments) {
        const rel = a.path;
        if (member.blockKind === "meta") registerAssignment(`meta.${rel.join(".")}`, a, ir.meta, rel, ctx);
        else if (member.blockKind === "identity") registerAssignment(`identity.${rel.join(".")}`, a, ir.identity, rel, ctx);
        else if (member.blockKind === "traits") registerAssignment(`traits.${rel.join(".")}`, a, ir.base.traits, rel, ctx);
        else if (member.blockKind === "values") registerAssignment(`values.${rel.join(".")}`, a, ir.base.values, rel, ctx);
        else if (member.blockKind === "preferences") registerAssignment(`preferences.${rel.join(".")}`, a, ir.base.preferences, rel, ctx);
        else if (member.blockKind === "style") registerAssignment(`style.${rel.join(".")}`, a, ir.base.style, rel, ctx);
        else if (member.blockKind === "context") registerAssignment(`context.${rel.join(".")}`, a, ir.contextDefaults, rel, ctx);
        else if (member.blockKind === "state") registerAssignment(`state.${rel.join(".")}`, a, ir.runtimeInitial.state, rel, ctx);
      }
    } else if (member.kind === "NamedBlock") {
      if (member.blockKind === "relationship") {
        const sink = ir.runtimeInitial.relationships[member.name] ??= {};
        for (const a of member.assignments) registerAssignment(`relationships.${member.name}.${a.path.join(".")}`, a, sink, a.path, ctx);
      } else {
        const sink = ir.base.behaviors[member.name] ??= {};
        for (const a of member.assignments) registerAssignment(`behaviors.${member.name}.${a.path.join(".")}`, a, sink, a.path, ctx);
      }
    }
  }

  // Local semantic texture after symbols exist.
  for (const ctx of contexts) if (ctx.member.kind === "Describe") {
    const member = ctx.member;
    const path = member.path.join(".");
    if (!ir.symbols[path]) diagnostics.push({ code: "PPL-E201", severity: "error", message: `Describe target '${path}' is not declared.`, range: member.range });
    const binding = ir.semanticBindings[path] ??= { path, primitive: ir.symbols[path]?.primitive ?? "Float01", renderPriority: 50 };
    const local = binding.localDescriptors ??= {};
    if (local[member.locale]) diagnostics.push({ code: "PPL-E324", severity: "error", message: `Duplicate describe block for '${path}' locale '${member.locale}'.`, range: member.range });
    const descriptors: any = {};
    for (const band of semanticBands) if (typeof member.entries[band] === "string") descriptors[band] = member.entries[band];
    local[member.locale] = {
      label: typeof member.entries.label === "string" ? member.entries.label : undefined,
      priority: typeof member.entries.priority === "number" ? member.entries.priority : undefined,
      descriptors
    };
    if (typeof member.entries.priority === "number") binding.renderPriority = member.entries.priority;
  }

  // Semantic lint after local describes.
  for (const [path, symbol] of Object.entries(ir.symbols)) {
    const semanticNamespace = /^(traits|values|preferences|relationships|state|style|behaviors|context)\./.test(path);
    const hasLocalDescriptor = Boolean(ir.semanticBindings[path]?.localDescriptors);
    if (semanticNamespace && symbol.primitive === "Float01" && !symbol.semanticType && !hasLocalDescriptor) diagnostics.push({
      code: "PPL-W251", severity: "warning",
      message: `Float01 field '${path}' has no semantic type or local describe block; generic rendering may be ambiguous.`
    });
  }
  for (const path of Object.keys(ir.symbols)) if (path.startsWith("traits.")) {
    const stylePath = `style.${path.slice("traits.".length)}`;
    if (ir.symbols[stylePath]) diagnostics.push({ code: "PPL-W310", severity: "warning", message: `Trait/style shadow: '${path}' overlaps '${stylePath}'. Consider separating personality disposition from output style.` });
  }

  const allowedExternal = (p: string) => p.startsWith("event.");
  const checkPath = (p: string, range?: any) => {
    if (!ir.symbols[p] && !allowedExternal(p)) diagnostics.push({ code: "PPL-E201", severity: "error", message: `Unknown symbol '${p}'.`, range });
  };
  const checkExpr = (expr: IRExpr, range?: any) => { for (const p of collectExprPaths(expr)) checkPath(p, range); };
  const ruleIds = new Set<string>();
  const invariantIds = new Set<string>();
  const transitionIds = new Set<string>();
  const testIds = new Set<string>();

  // Pass 2: executable semantics.
  for (const ctx of contexts) {
    const member = ctx.member;
    if (member.kind === "Rule") {
      const id = memberId(ctx.origin, member.name, ctx.imported);
      if (ruleIds.has(id)) diagnostics.push({ code: "PPL-E322", severity: "error", message: `Duplicate rule '${id}'.`, range: member.range });
      ruleIds.add(id);
      if (member.priority < 0 || member.priority > 1000) diagnostics.push({ code: "PPL-E401", severity: "error", message: `Rule priority for '${id}' must be in [0,1000].`, range: member.range });
      validateAstExpr(member.condition, ir.symbols, diagnostics, member.range);
      const condition = normalizeExpr(member.condition); checkExpr(condition, member.range);
      const effects = member.effects.map(e => {
        let path = e.path.join(".");
        if (e.op === "enable" || e.op === "disable") path += ".enabled";
        checkPath(path, e.range);
        const ns = path.split(".")[0];
        if (!["traits", "values", "style", "behaviors", "state"].includes(ns)) diagnostics.push({ code: "PPL-E522", severity: "error", message: `Illegal effect target '${path}'.`, range: e.range });
        if (e.value) {
          checkExpr(normalizeExpr(e.value), e.range);
          const actual = validateAstExpr(e.value, ir.symbols, diagnostics, e.range);
          const expected = ir.symbols[path]?.primitive;
          if ((e.op === "add" || e.op === "sub") && (!isNumericPrimitive(expected) || !isNumericPrimitive(actual))) diagnostics.push({ code: "PPL-E246", severity: "error", message: `Effect '${e.op}' on '${path}' requires numeric target and value.`, range: e.range });
          if (e.op === "set" && !compatiblePrimitive(expected, actual)) diagnostics.push({ code: "PPL-E247", severity: "error", message: `SET effect type mismatch on '${path}': expected ${expected}, received ${actual}.`, range: e.range });
        } else if ((e.op === "enable" || e.op === "disable") && ir.symbols[path]?.primitive !== "Bool") diagnostics.push({ code: "PPL-E248", severity: "error", message: `${e.op} requires Bool behavior target '${path}'.`, range: e.range });
        return { op: e.op, path, value: e.value ? normalizeExpr(e.value) : undefined };
      });
      const commits = member.commits.map(c => {
        const path = c.path.join("."); checkPath(path, c.range);
        const ns = path.split(".")[0];
        if (!["relationships", "state"].includes(ns)) diagnostics.push({ code: "PPL-E521", severity: "error", message: `Illegal commit target '${path}'.`, range: c.range });
        checkExpr(normalizeExpr(c.value), c.range);
        const actual = validateAstExpr(c.value, ir.symbols, diagnostics, c.range);
        const expected = ir.symbols[path]?.primitive;
        if ((c.op === "add" || c.op === "sub") && (!isNumericPrimitive(expected) || !isNumericPrimitive(actual))) diagnostics.push({ code: "PPL-E246", severity: "error", message: `Commit '${c.op}' on '${path}' requires numeric target and value.`, range: c.range });
        if (c.op === "set" && !compatiblePrimitive(expected, actual)) diagnostics.push({ code: "PPL-E247", severity: "error", message: `SET commit type mismatch on '${path}': expected ${expected}, received ${actual}.`, range: c.range });
        return { op: c.op, path, value: normalizeExpr(c.value) };
      });
      ir.rules.push({ id, priority: member.priority, condition, effects, commits, provenance: ctx.origin });
    } else if (member.kind === "Invariant") {
      const id = memberId(ctx.origin, member.name, ctx.imported);
      if (invariantIds.has(id)) diagnostics.push({ code: "PPL-E325", severity: "error", message: `Duplicate invariant '${id}'.`, range: member.range });
      invariantIds.add(id);
      for (const a of member.assertions) { const t = validateAstExpr(a, ir.symbols, diagnostics, member.range); if (t && t !== "Bool") diagnostics.push({ code: "PPL-E249", severity: "error", message: `Invariant assertion must be Bool.`, range: member.range }); }
      const assertions = member.assertions.map(a => normalizeExpr(a));
      for (const a of assertions) checkExpr(a, member.range);
      ir.invariants.push({ id, priority: member.priority, assertions, guides: member.guides, provenance: ctx.origin });
    } else if (member.kind === "Transition") {
      const id = memberId(ctx.origin, member.name, ctx.imported);
      if (transitionIds.has(id)) diagnostics.push({ code: "PPL-E326", severity: "error", message: `Duplicate transition '${id}'.`, range: member.range });
      transitionIds.add(id);
      const target = member.target.join("."); checkPath(target, member.range);
      if (!target.startsWith("relationships.") && !target.startsWith("state.")) diagnostics.push({ code: "PPL-E523", severity: "error", message: `Transition target '${target}' must be runtime-owned.`, range: member.range });
      validateAstExpr(member.condition, ir.symbols, diagnostics, member.range);
      const targetPrimitive = ir.symbols[target]?.primitive;
      for (const v of [...member.from, member.to]) { const issue = targetPrimitive ? validatePrimitive(v, targetPrimitive) : undefined; if (issue) diagnostics.push({ code: "PPL-E524", severity: "error", message: `Transition '${id}' value for '${target}' is invalid: ${issue}.`, range: member.range }); }
      validateAstExpr(member.condition, ir.symbols, diagnostics, member.range);
      const condition = normalizeExpr(member.condition); checkExpr(condition, member.range);
      ir.transitions.push({ id, target, from: member.from, to: member.to, condition, provenance: ctx.origin });
    } else if (member.kind === "Note") {
      ir.notes.push({ id: memberId(ctx.origin, member.name, ctx.imported), text: member.text, provenance: ctx.origin });
    } else if (member.kind === "Example") {
      const given: Record<string, IRValue> = {};
      for (const g of member.given) { const p = g.path.join("."); checkPath(p, g.range); given[p] = g.value.value; }
      ir.examples.push({ id: member.name, given, output: member.output, provenance: ctx.origin });
    } else if (member.kind === "Test") {
      if (testIds.has(member.name)) diagnostics.push({ code: "PPL-E701", severity: "error", message: `Duplicate source test '${member.name}'.`, range: member.range });
      testIds.add(member.name);
      const given: Record<string, IRValue> = {};
      for (const g of member.given) {
        const p = g.path.join(".");
        if (!ir.symbols[p] && !allowedExternal(p)) diagnostics.push({ code: "PPL-E201", severity: "error", message: `Unknown test fixture path '${p}'.`, range: g.range });
        if (!/^(relationships|state|context|event)\./.test(p)) diagnostics.push({ code: "PPL-E702", severity: "error", message: `Source test given path '${p}' must be runtime-, context-, or event-owned.`, range: g.range });
        given[p] = g.value.value;
      }
      for (const e of member.expects) { const t = validateAstExpr(e, ir.symbols, diagnostics, member.range); if (t && t !== "Bool") diagnostics.push({ code: "PPL-E703", severity: "error", message: `Source test expect expression must be Bool.`, range: member.range }); }
      const expects = member.expects.map(e => normalizeExpr(e));
      for (const e of expects) checkExpr(e, member.range);
      ir.tests.push({ id: member.name, given, expects, provenance: ctx.origin });
    }
  }

  // Scenes are root authoring assets, not module mutations.
  for (const d of ast.declarations) if (d.kind === "Scene") compileScene(d, ir, diagnostics);

  // Stable transition/commit static conflict: a rule commit and transition targeting same path can both fire; runtime detects actual co-activation.
  const commitTargets = new Set(ir.rules.flatMap(r => r.commits.map(c => c.path)));
  for (const t of ir.transitions) if (commitTargets.has(t.target)) diagnostics.push({ code: "PPL-W511", severity: "warning", message: `Transition target '${t.target}' is also modified by a commit rule; runtime will reject co-active mutations.` });

  ir.rules.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  ir.transitions.sort((a, b) => a.id.localeCompare(b.id));
  ir.invariants.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  ir.notes.sort((a, b) => a.id.localeCompare(b.id));
  ir.tests.sort((a, b) => a.id.localeCompare(b.id));
  ir.diagnostics = diagnostics;
  return diagnostics.some(d => d.severity === "error") ? undefined : ir;
}

function compileScene(scene: SceneNode, ir: StaticPersonaIR, diagnostics: Diagnostic[]) {
  const context: Record<string, IRValue> = {};
  const state: Record<string, IRValue> = {};
  for (const a of scene.context.assignments) {
    const p = `context.${a.path.join(".")}`;
    if (!ir.symbols[p]) diagnostics.push({ code: "PPL-E201", severity: "error", message: `Scene '${scene.name}' references unknown context field '${p}'.`, range: a.range });
    else {
      const issue = validatePrimitive(a.value.value, ir.symbols[p].primitive);
      if (issue) diagnostics.push({ code: "PPL-E253", severity: "error", message: `Scene '${scene.name}' invalid value for '${p}': ${issue}.`, range: a.range });
    }
    setNested(context, a.path, a.value.value);
  }
  for (const a of scene.state?.assignments ?? []) {
    const p = `state.${a.path.join(".")}`;
    if (!ir.symbols[p]) diagnostics.push({ code: "PPL-E201", severity: "error", message: `Scene '${scene.name}' references unknown state field '${p}'.`, range: a.range });
    else {
      const issue = validatePrimitive(a.value.value, ir.symbols[p].primitive);
      if (issue) diagnostics.push({ code: "PPL-E253", severity: "error", message: `Scene '${scene.name}' invalid value for '${p}': ${issue}.`, range: a.range });
    }
    setNested(state, a.path, a.value.value);
  }
  if (ir.scenes[scene.name]) diagnostics.push({ code: "PPL-E327", severity: "error", message: `Duplicate scene '${scene.name}'.`, range: scene.range });
  else ir.scenes[scene.name] = { context, state };
}

export function compile(source: string, file = "<memory>", options: CompileOptions = {}): CompileResult {
  const parsed = parseSource(source, file);
  const diagnostics = [...parsed.diagnostics];
  if (!parsed.ast || diagnostics.some(d => d.severity === "error")) return { diagnostics, ast: parsed.ast };
  const ir = compileProgram(parsed.ast, file, options, diagnostics);
  return { ir, diagnostics, ast: parsed.ast };
}
