import { createHash } from 'node:crypto'
import { mergeScene, resolve } from '../vendor/pplc/runtime.js'
import { render } from '../vendor/pplc/renderer.js'
import { createHostSnapshot } from './host-snapshot.js'

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function mergeRecords(a, b) {
  const out = { ...a }
  for (const [key, value] of Object.entries(b ?? {})) {
    const before = out[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)
      && before !== null && typeof before === 'object' && !Array.isArray(before)) {
      out[key] = mergeRecords(before, value)
    } else out[key] = value
  }
  return out
}

export class PersonaRuntime {
  constructor(config) {
    if (config?.persona?.schema !== 'ppl.persona-ir/0.3') {
      throw new Error(`@ppl/runtime: expected PPL 0.3 Persona IR, got ${String(config?.persona?.schema)}`)
    }
    this.ir = config.persona
    this.irSha256 = sha256Json(config.persona)
    this.scene = config.scene
    this.contextOverride = config.context ?? {}
    this.profile = config.profile ?? 'standard'
  }

  personaBinding() {
    return { id: this.ir.persona.id, version: this.ir.persona.version, irSha256: this.irSha256 }
  }

  materialize(runtime, context = {}) {
    const overrides = mergeRecords(this.contextOverride, context)
    if (!this.scene) return { runtime, context: overrides }
    return mergeScene(this.ir, this.scene, runtime, overrides)
  }

  staticPrompt(runtime = { session: { id: 'static', turn: 0 } }) {
    const base = resolve(this.ir, runtime, {}, {})
    return render(this.ir, base, this.profile).staticPrompt
  }

  resolveHostStep(input) {
    const materialized = this.materialize(input.runtime, input.context)
    const resolution = resolve(this.ir, materialized.runtime, materialized.context, input.event)
    if (!resolution.valid) {
      const errors = resolution.diagnostics?.filter(x => x.severity === 'error').map(x => `${x.code}: ${x.message}`).join('; ')
      throw new Error(`PPL resolution invalid: ${errors || 'unknown error'}`)
    }
    const rendered = render(this.ir, resolution, this.profile)
    const dynamicPrompt = [
      'Current PPL persona runtime snapshot. This snapshot supersedes earlier PPL persona snapshots.',
      '',
      rendered.dynamicPrompt,
    ].join('\n')
    const snapshot = createHostSnapshot({
      host: { kind: input.hostKind ?? 'unknown' },
      persona: this.personaBinding(),
      turn: input.turn,
      step: input.step,
      event: input.event,
      context: materialized.context,
      resolution,
    })
    return { resolution, staticPrompt: rendered.staticPrompt, dynamicPrompt, snapshot, context: materialized.context }
  }
}
