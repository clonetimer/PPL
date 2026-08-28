# PPL 0.3 Usage Patterns

## 1. Prompt-only authoring

Use PPL as a typed, testable replacement for a traditional role card.

```bash
ppl check persona.ppl
ppl test persona.ppl
ppl render persona.ppl --profile standard
```

No persistent runtime is required. The result is an ordinary static/dynamic persona prompt pair.

## 2. Build-once / resolve-per-turn chat runtime

Startup:

```text
source -> compile -> Persona IR
```

Each conversation turn:

```text
runtime + context + event
    -> resolve
    -> render
    -> LLM
    -> applyResolution on success
```

The compiler is not rerun every turn.

## 3. Built Persona Package / deployment artifact

`*.pir.json` contains the Semantic Closure and can be deployed without source modules.

```bash
ppl build persona.ppl --module-root modules --out persona.pir.json
ppl render persona.pir.json --runtime runtime.json --context context.json
```

This is the recommended production boundary for 0.3.

## 4. Scene selection

Use `scene` for reusable situational defaults:

```ppl
scene PRIVATE_NIGHT {
    context {
        privacy = absolute;
        outsiders_present = false;
        danger = 0.0;
    }
}
```

Then:

```bash
ppl render persona.pir.json --scene PRIVATE_NIGHT
```

Explicit runtime/context input overrides scene defaults.

## 5. Relationship development

Use a `transition` for discrete relationship stages and numeric relationship fields for continuous dimensions:

```text
stage: trusted -> lover
trust: 0.86 -> 0.87 -> ...
```

A transition/commit is emitted as pending state and only persisted after the host interaction succeeds.

## 6. Modular persona authoring

Use modules for reusable semantics and behavior components:

```ppl
import psychology.survivor_core version "^1.0.0";
```

Imports are parsed and type-checked. They do not concatenate raw prompt strings.

## 7. Custom semantic vocabulary

A project can define domain-specific dimensions:

```ppl
module wuling.semantic version "1.0.0" {
    semantic trait responsibility_internalization {
        primitive = Float01;
        scale = standard5;
        label.zh_CN = "责任内化";
        // ...
    }
}
```

The Persona can import it under an alias and the compiled IR embeds the used semantic definition.

## 8. Deterministic persona unit testing

Use source tests for rules and state resolution:

```ppl
test PRIVATE_MODE {
    given {
        relationships.admin.stage = lover;
        context.privacy = absolute;
    }
    expect {
        behaviors.private_closeness.enabled == true;
    }
}
```

These tests do not call an LLM and should form the bottom of the Persona test pyramid.

## 9. Game/NPC integration

Natural-language classification is optional. A game engine can inject events directly:

```json
{ "type": "DANGER", "actor": "enemy" }
```

PPL remains responsible for persona resolution while the game remains authoritative for world facts.

## 10. Recommended authoring layers

```text
Base Persona       stable identity / traits / values
Semantic Types     shared meaning
Rules              conditional modifications
Runtime            relationship / state history
Scene              reusable environment defaults
Host Context        current world facts
Event               current interaction classification
Renderer            LLM-facing natural language
```

Avoid creating separate “public persona”, “private persona” and “combat persona” files when the same character can be represented as Base + Rules + Runtime + Context.
