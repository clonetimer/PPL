#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { lex } from "./lexer.js";
import { parse } from "./parser.js";
import { formatAst } from "./formatter.js";
import { compileFile, loadPersonaIR } from "./fs-project.js";
import { applyResolution, mergeScene, resolve, runSourceTests } from "./runtime.js";
import { render } from "./renderer.js";

function arg(flag: string, args: string[]) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }
function has(flag: string, args: string[]) { return args.includes(flag); }
function readJson(file?: string) { return file ? JSON.parse(fs.readFileSync(file, "utf8")) : {}; }
function fail(message: string): never { console.error(message); process.exit(1); }
function moduleRoot(args: string[]) { return arg("--module-root", args); }

const args = process.argv.slice(2);
const command = args[0];
const file = args[1];
if (!command || !file) fail("Usage: ppl <check|build|test|render|why|fmt> <file.ppl> [options]");

if (command === "fmt") {
  const source = fs.readFileSync(file, "utf8");
  const lx = lex(source, file); const ps = parse(lx.tokens); const ds = [...lx.diagnostics, ...ps.diagnostics];
  if (!ps.ast || ds.some(d => d.severity === "error")) fail(ds.map(d => `${d.code}: ${d.message}`).join("\n"));
  const formatted = formatAst(ps.ast);
  if (has("--write", args)) { fs.writeFileSync(file, formatted); console.log(file); }
  else process.stdout.write(formatted);
  process.exit(0);
}

const isIR = file.endsWith(".pir.json");
const compiled = isIR ? undefined : compileFile(file, { moduleRoot: moduleRoot(args) });
if (command === "check") {
  if (isIR) fail("check expects PPL source; Persona IR is a build artifact.");
  for (const d of compiled!.diagnostics) console.log(`${d.severity.toUpperCase()} ${d.code}: ${d.message}`);
  const errors = compiled!.diagnostics.filter(d => d.severity === "error").length;
  const warnings = compiled!.diagnostics.filter(d => d.severity === "warning").length;
  if (!errors) console.log(`✓ syntax\n✓ modules\n✓ symbols\n✓ semantic bindings\n✓ rule targets\n✓ transitions\n\n0 errors, ${warnings} warnings`);
  process.exit(compiled!.ir ? 0 : 1);
}
if (command === "build" && isIR) fail("build expects PPL source, not an existing Persona IR artifact.");
if (compiled && !compiled.ir) fail(compiled.diagnostics.map(d => `${d.code}: ${d.message}`).join("\n"));
const ir = isIR ? loadPersonaIR(file) : compiled!.ir!;

if (command === "build") {
  const out = arg("--out", args) ?? path.join(path.dirname(file), `${path.basename(file, ".ppl")}.pir.json`);
  fs.writeFileSync(out, JSON.stringify(ir, null, 2));
  console.log(out);
  process.exit(0);
}
if (command === "test") {
  const result = runSourceTests(ir);
  for (const r of result.results) {
    console.log(`${r.passed ? "PASS" : "FAIL"} ${r.id}`);
    for (const f of r.failures) console.log(`  ${f}`);
  }
  console.log(`\n${result.passed} passed, ${result.failed} failed`);
  process.exit(result.failed ? 2 : 0);
}

let runtime = readJson(arg("--runtime", args));
let context = readJson(arg("--context", args));
const event = readJson(arg("--event", args));
const scene = arg("--scene", args);
if (scene) {
  try { const merged = mergeScene(ir, scene, runtime, context); runtime = merged.runtime; context = merged.context; }
  catch (e) { fail((e as Error).message); }
}
const resolution = resolve(ir, runtime, context, event);

if (command === "render") {
  const profile = (arg("--profile", args) ?? "standard") as "compact" | "standard" | "full" | "debug";
  const output = render(ir, resolution, profile);
  console.log(output.staticPrompt + "\n\n" + output.dynamicPrompt);
  if (resolution.pendingCommits.length) console.log("\n[PENDING COMMITS]\n" + JSON.stringify(resolution.pendingCommits, null, 2));
  if (resolution.pendingTransitions.length) console.log("\n[PENDING TRANSITIONS]\n" + JSON.stringify(resolution.pendingTransitions, null, 2));
  if (has("--commit-preview", args)) console.log("\n[NEXT RUNTIME PREVIEW]\n" + JSON.stringify(applyResolution(runtime, resolution), null, 2));
  process.exit(resolution.valid ? 0 : 2);
}
if (command === "why") {
  const target = args[2]; if (!target) fail("Usage: ppl why <file.ppl> <canonical.path> [options]");
  const tr = resolution.trace[target]; if (!tr) fail(`No effect trace for '${target}'.`);
  const binding = ir.semanticBindings[target];
  console.log(`${target}\n`);
  if (binding?.semanticType) console.log(`Semantic type: ${binding.semanticType}`);
  console.log(`Base: ${tr.base}${tr.baseBand ? ` (${tr.baseBand})` : ""}`);
  for (const s of tr.steps) console.log(`[P${s.priority}] ${s.rule}: ${s.op}${s.value !== undefined ? ` ${JSON.stringify(s.value)}` : ""} -> ${JSON.stringify(s.after)}`);
  console.log(`Final: ${tr.final}${tr.finalBand ? ` (${tr.finalBand})` : ""}`);
  if (tr.delta !== undefined) console.log(`Delta: ${tr.delta.toFixed(3)} (${tr.deltaMagnitude})`);
  process.exit(0);
}
fail(`Unknown command '${command}'.`);
