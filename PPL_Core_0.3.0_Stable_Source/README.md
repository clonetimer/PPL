# Persona Programming Language (PPL) — 0.3 Stable Reference Implementation

PPL 0.3 is a deterministic persona DSL and runtime contract for turning modular character source code into a resolved persona snapshot and an LLM-facing prompt.

The stable pipeline is:

```text
.ppl source
  -> lexer / parser / AST
  -> module graph + semantic registry
  -> static type / mutability checks
  -> self-contained Persona IR
  -> runtime + host context + event
  -> frozen-snapshot rule matching
  -> deterministic effect resolution
  -> pending commit / transition
  -> invariant validation + provenance trace
  -> semantic renderer
  -> LLM prompt
```

## What 0.3 Stable implements

Language:

- `persona`, `module`, `scene`, `import`
- custom `semantic` declarations and import aliases
- `meta`, `identity`, `traits`, `values`, `preferences`
- `relationship`, `context`, `state`, `style`, `behavior`
- `rule`, `when`, `effect`, `commit`
- `transition`
- `invariant` (`assert` + `guide`)
- `describe`, `note`, `example`, `test`
- primitive types and semantic types
- standard five-band Semantic ABI

Compiler/runtime:

- module version constraints and cycle detection
- custom semantic closure embedded into Persona IR
- duplicate declaration rejection (no last-write-wins)
- static expression/effect/commit type checks
- frozen rule match set
- deterministic priority buckets
- Float01 clamping and 12-decimal numeric canonicalization
- explicit pending commits and pending transitions
- transition/commit conflict detection
- scene overlays
- deterministic source tests with no LLM dependency
- provenance traces for `why`

Tooling:

- `check`
- `build`
- `test`
- `render`
- `why`
- `fmt`

## Install / build

```bash
npm install
npm run build
npm test
```

The conformance suite currently contains **21 tests**, plus source tests embedded in the three official reference personas.

## Reference personas

- `examples/cetacea_girl/persona.ppl` — minimal/static authoring
- `examples/zhuang_fangyi/persona.ppl` — relationship, custom semantic, transition, scene
- `examples/li_zhiyan/persona.ppl` — imported psychology module, trauma trigger, private/danger overrides

Check all three:

```bash
npm run check:refs
npm run test:refs
```

## CLI usage

Check:

```bash
node dist/src/cli.js check examples/zhuang_fangyi/persona.ppl \
  --module-root modules
```

Build self-contained Persona IR:

```bash
node dist/src/cli.js build examples/zhuang_fangyi/persona.ppl \
  --module-root modules \
  --out artifacts/zhuang_fangyi.pir.json
```

The built IR is directly consumable; modules are no longer needed:

```bash
node dist/src/cli.js test artifacts/zhuang_fangyi.pir.json
node dist/src/cli.js render artifacts/zhuang_fangyi.pir.json \
  --runtime examples/zhuang_fangyi/runtime.lover.json \
  --scene PRIVATE_NIGHT
```

Run source-level deterministic tests:

```bash
node dist/src/cli.js test examples/li_zhiyan/persona.ppl \
  --module-root modules
```

Render a named scene:

```bash
node dist/src/cli.js render examples/li_zhiyan/persona.ppl \
  --module-root modules \
  --scene AMBUSH \
  --profile debug
```

Explain one computed field:

```bash
node dist/src/cli.js why examples/zhuang_fangyi/persona.ppl \
  traits.emotional_guard \
  --module-root modules \
  --runtime examples/zhuang_fangyi/runtime.lover.json \
  --scene PRIVATE_NIGHT
```

Format to stdout:

```bash
node dist/src/cli.js fmt examples/zhuang_fangyi/persona.ppl
```

Rewrite in place:

```bash
node dist/src/cli.js fmt examples/zhuang_fangyi/persona.ppl --write
```

The 0.3 formatter is AST-based and preserves semantics, but intentionally does **not** preserve comments. Use `--write` only when that is acceptable.

## Host integration

```ts
import { compileFile, resolve, render, applyResolution } from "./dist/src/index.js";

const compiled = compileFile("persona.ppl", { moduleRoot: "modules" });
if (!compiled.ir) throw new Error("compile failed");

const resolution = resolve(
  compiled.ir,
  runtimeState,
  hostContext,
  event
);

const prompt = render(compiled.ir, resolution, "standard");
const llmResult = await callYourModel(prompt.staticPrompt, prompt.dynamicPrompt);

if (llmResult.ok && resolution.valid) {
  runtimeState = applyResolution(runtimeState, resolution);
}
```

The host owns event classification, context facts, LLM invocation, and the decision to persist pending mutations.

## Stable boundaries

0.3 deliberately does not provide arbitrary functions, loops, `eval`, network access, file access from PPL source, dynamic runtime imports, memory databases, probabilistic rules, or multi-agent coordination.

Package registries, `ppl.lock`, a REPL, VS Code integration, richer enums, memory, and LLM conversation tests are post-0.3 tooling/language work.

See `SPEC_0.3_STABLE.md` for the frozen semantics and `SPEC_RC5.md` for the RC4 -> Stable completion pass.
