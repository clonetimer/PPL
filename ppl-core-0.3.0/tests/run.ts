import assert from "node:assert/strict";
import fs from "node:fs";
import { compile } from "../src/compiler.js";
import { compileFile } from "../src/fs-project.js";
import { lex } from "../src/lexer.js";
import { parse } from "../src/parser.js";
import { formatAst } from "../src/formatter.js";
import { applyPendingCommits, applyResolution, mergeScene, resolve, runSourceTests } from "../src/runtime.js";
import { render } from "../src/renderer.js";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { console.error(`FAIL ${name}`); throw e; }
}
function okCompile(src: string) { const c = compile(src); assert.ok(c.ir, JSON.stringify(c.diagnostics)); return c.ir!; }

const rc4DemoSource = fs.readFileSync("examples/demo.ppl", "utf8");
const demoCompiled = compile(rc4DemoSource, "examples/demo.ppl");
assert.ok(demoCompiled.ir, JSON.stringify(demoCompiled.diagnostics));
const demo = demoCompiled.ir!;
const runtime = JSON.parse(fs.readFileSync("examples/runtime.json", "utf8"));
const privateCtx = JSON.parse(fs.readFileSync("examples/context.private.json", "utf8"));
const event = JSON.parse(fs.readFileSync("examples/event.comfort.json", "utf8"));

test("vertical slice: semantic bind -> resolve -> trace -> render", () => {
  const r = resolve(demo, runtime, privateCtx, event);
  assert.equal(r.valid, true);
  assert.deepEqual(r.activeRules.map(x => x.id), ["ADMIN_COMFORT_TRUST", "FATIGUE_DISCLOSURE", "PRIVATE_THAW"]);
  assert.equal(r.resolvedFlat["traits.emotional_guard"], 0.32);
  assert.equal(r.trace["traits.emotional_guard"].baseBand, "very_high");
  assert.equal(r.trace["traits.emotional_guard"].finalBand, "low");
  assert.equal(r.trace["traits.emotional_guard"].deltaMagnitude, "strong");
  assert.equal(r.resolvedFlat["behaviors.private_closeness.enabled"], true);
  assert.equal(r.pendingCommits[0].projected, 0.97);
  const rendered = render(demo, r);
  assert.match(rendered.dynamicPrompt, /情感防线当前显著降低/);
});

test("frozen match set", () => {
  const ir = okCompile(`persona T { state { emotion.anxiety: std.state.anxiety = 0.30; } rule A priority 500 { when { true; } effect { state.emotion.anxiety += 0.40; } } rule B priority 600 { when { state.emotion.anxiety >= 0.50; } effect { state.emotion.anxiety += 0.10; } } }`);
  const r = resolve(ir);
  assert.deepEqual(r.activeRules.map(x => x.id), ["A"]);
  assert.equal(r.resolvedFlat["state.emotion.anxiety"], 0.7);
});

test("priority bucket semantics", () => {
  const ir = okCompile(`persona T { traits { warmth: std.trait.warmth = 0.40; } rule A priority 500 { when { true; } effect { traits.warmth += 0.10; } } rule B priority 700 { when { true; } effect { traits.warmth += 0.20; } } rule C priority 800 { when { true; } effect { traits.warmth = 0.30; } } rule D priority 900 { when { true; } effect { traits.warmth += 0.15; } } }`);
  assert.equal(resolve(ir).resolvedFlat["traits.warmth"], 0.45);
});

test("same-priority mixed set/add is runtime error", () => {
  const ir = okCompile(`persona T { traits { warmth: std.trait.warmth = 0.40; } rule A priority 700 { when { true; } effect { traits.warmth = 0.30; } } rule B priority 700 { when { true; } effect { traits.warmth += 0.20; } } }`);
  const r = resolve(ir);
  assert.equal(r.valid, false);
  assert.ok(r.diagnostics.some(d => d.code === "PPL-E412"));
});

test("commit isolation and explicit apply", () => {
  const r = resolve(demo, runtime, privateCtx, event);
  assert.equal(runtime.relationships.admin.trust, 0.96);
  assert.equal(r.pendingCommits[0].projected, 0.97);
  const next = applyPendingCommits(runtime, r) as any;
  assert.equal(next.relationships.admin.trust, 0.97);
  assert.equal(runtime.relationships.admin.trust, 0.96);
});

test("custom semantic alias import + semantic closure", () => {
  const c = compileFile("examples/zhuang_fangyi/persona.ppl", { moduleRoot: "modules" });
  assert.ok(c.ir, JSON.stringify(c.diagnostics));
  const ir = c.ir!;
  const b = ir.semanticBindings["traits.responsibility"];
  assert.equal(b.semanticType, "wuling.semantic.responsibility_internalization");
  assert.ok(ir.semanticClosure.types["wuling.semantic.responsibility_internalization"]);
  assert.equal(ir.semanticClosure.registries["wuling.semantic"], "1.0.0");
});

test("built Persona IR renders without source modules or registry lookup", () => {
  const c = compileFile("examples/zhuang_fangyi/persona.ppl", { moduleRoot: "modules" }); assert.ok(c.ir, JSON.stringify(c.diagnostics));
  const roundTripped = JSON.parse(JSON.stringify(c.ir));
  const r = resolve(roundTripped, { relationships: { admin: { stage: "lover", trust: 0.96 } } }, { privacy: "absolute", outsiders_present: false, danger: 0 }, {});
  const out = render(roundTripped, r);
  assert.match(out.staticPrompt, /责任内化/);
  assert.match(out.dynamicPrompt, /情感防线当前显著降低/);
});

test("module rule composes semantically, not by text concatenation", () => {
  const c = compileFile("examples/li_zhiyan/persona.ppl", { moduleRoot: "modules" }); assert.ok(c.ir, JSON.stringify(c.diagnostics));
  const r = resolve(c.ir!, {}, { privacy: "private", outsiders_present: false, danger: 0 }, { type: "TRAUMA_REMINDER" });
  assert.ok(r.activeRules.some(x => x.id === "psychology.survivor_core::TRAUMA_REMINDER"));
  assert.equal(r.resolvedFlat["behaviors.trauma_avoidance.enabled"], true);
  assert.equal(r.resolvedFlat["state.emotion.anxiety"], 0.4);
});

test("transition is pending until host applies resolution", () => {
  const ir = okCompile(`persona T { relationship admin { stage: Symbol = trusted; trust: std.relationship.trust = 0.90; } transition ACCEPT { target relationships.admin.stage; from [trusted, close]; to lover; when { event.type == CONFESSION and relationships.admin.trust >= 0.85; } } }`);
  const r = resolve(ir, {}, {}, { type: "CONFESSION" });
  assert.equal(r.resolvedFlat["relationships.admin.stage"], "trusted");
  assert.equal(r.pendingTransitions[0].to, "lover");
  const next = applyResolution({}, r) as any;
  assert.equal(next.relationships.admin.stage, "lover");
});

test("co-active transition and commit on same target is rejected", () => {
  const ir = okCompile(`persona T { relationship admin { stage: Symbol = trusted; } rule R { when { event.type == GO; } commit { relationships.admin.stage = lover; } } transition X { target relationships.admin.stage; from [trusted]; to close; when { event.type == GO; } } }`);
  const r = resolve(ir, {}, {}, { type: "GO" });
  assert.equal(r.valid, false);
  assert.ok(r.diagnostics.some(d => d.code === "PPL-E532"));
});

test("source-level deterministic tests execute without LLM", () => {
  const c = compileFile("examples/zhuang_fangyi/persona.ppl", { moduleRoot: "modules" }); assert.ok(c.ir, JSON.stringify(c.diagnostics));
  const result = runSourceTests(c.ir!);
  assert.equal(result.failed, 0);
  assert.equal(result.passed, 2);
});

test("scene overlays host context/state without cloning persona", () => {
  const c = compileFile("examples/zhuang_fangyi/persona.ppl", { moduleRoot: "modules" }); assert.ok(c.ir, JSON.stringify(c.diagnostics));
  const merged = mergeScene(c.ir!, "PRIVATE_NIGHT", { state: { physical: { fatigue: 0.66 }, emotion: { embarrassment: 0.2 } } }, { danger: 0.03 });
  assert.equal((merged.runtime.state as any).physical.fatigue, 0.66);
  assert.equal((merged.runtime.state as any).emotion.embarrassment, 0.2);
  assert.equal((merged.context as any).privacy, "absolute");
  assert.equal((merged.context as any).danger, 0.03);
});

test("formatter is semantically idempotent", () => {
  const source = fs.readFileSync("examples/zhuang_fangyi/persona.ppl", "utf8");
  const p1 = parse(lex(source, "z.ppl").tokens); assert.ok(p1.ast);
  const f1 = formatAst(p1.ast!);
  const p2 = parse(lex(f1, "z2.ppl").tokens); assert.ok(p2.ast);
  const f2 = formatAst(p2.ast!);
  assert.equal(f1, f2);
});

test("module version constraint is enforced", () => {
  const src = `persona T { import demo.mod version "^1.0.0"; }`;
  const c = compile(src, "root.ppl", { moduleResolver: () => ({ id: "demo.mod", file: "demo.ppl", source: `module demo.mod version "0.9.0" {}` }) });
  assert.ok(!c.ir);
  assert.ok(c.diagnostics.some(d => d.code === "PPL-E304"));
});

test("import cycle is rejected", () => {
  const sources: Record<string, string> = {
    "a.mod": `module a.mod version "1.0.0" { import b.mod; }`,
    "b.mod": `module b.mod version "1.0.0" { import a.mod; }`
  };
  const c = compile(`persona T { import a.mod; }`, "root.ppl", { moduleResolver: id => sources[id] ? ({ id, file: `${id}.ppl`, source: sources[id] }) : undefined });
  assert.ok(!c.ir);
  assert.ok(c.diagnostics.some(d => d.code === "PPL-E303"));
});

test("duplicate module/persona field declaration is rejected", () => {
  const c = compile(`persona T { import m; traits { warmth: std.trait.warmth = 0.5; } }`, "root.ppl", { moduleResolver: () => ({ id: "m", file: "m.ppl", source: `module m { traits { warmth: std.trait.warmth = 0.4; } }` }) });
  assert.ok(!c.ir);
  assert.ok(c.diagnostics.some(d => d.code === "PPL-E321"));
});

test("semantic kind mismatch is a compile error", () => {
  const c = compile(`persona T { style { formality: std.trait.warmth = 0.8; } }`);
  assert.ok(!c.ir);
  assert.ok(c.diagnostics.some(d => d.code === "PPL-E251"));
});

test("static expression type mismatch is rejected", () => {
  const c = compile(`persona T { relationship admin { trust: std.relationship.trust = 0.8; } rule X { when { relationships.admin.trust == "high"; } } }`);
  assert.ok(!c.ir);
  assert.ok(c.diagnostics.some(d => d.code === "PPL-E242"));
});

test("ordered comparison only accepts numeric or built-in ordered symbols", () => {
  const c = compile(`persona T { identity { mood = happy; } rule X { when { identity.mood > sad; } } }`);
  assert.ok(!c.ir);
  assert.ok(c.diagnostics.some(d => d.code === "PPL-E245"));
});

test("Float01 range is enforced", () => {
  const c = compile(`persona T { traits { warmth: std.trait.warmth = 1.2; } }`);
  assert.ok(!c.ir);
  assert.ok(c.diagnostics.some(d => d.code === "PPL-E253"));
});

test("three reference personas compile and source-test cleanly", () => {
  for (const file of ["examples/cetacea_girl/persona.ppl", "examples/zhuang_fangyi/persona.ppl", "examples/li_zhiyan/persona.ppl"]) {
    const c = compileFile(file, { moduleRoot: "modules" }); assert.ok(c.ir, `${file}: ${JSON.stringify(c.diagnostics)}`);
    assert.equal(c.diagnostics.filter(d => d.severity === "error").length, 0);
    assert.equal(runSourceTests(c.ir!).failed, 0);
  }
});

console.log(`\n${passed} passed`);
