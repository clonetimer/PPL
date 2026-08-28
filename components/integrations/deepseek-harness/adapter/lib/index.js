/**
 * @ppl/adapter-dsh 0.1.0
 * DeepSeek Harness adapter for PPL Runtime 0.1 Stable.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve as resolvePath } from 'node:path'
import { findHarnessRoot, importHarnessEntry } from './harness-local.js'

const harnessRoot = findHarnessRoot()
const { createUserMessage } = await importHarnessEntry(harnessRoot, 'packages/llm/llm')
const { PERSONA_ORDER } = await importHarnessEntry(harnessRoot, 'packages/core/system-prompt')
import { PplDshBridge } from './bridge.js'

export { PplDshBridge } from './bridge.js'
export * from './dsh-projection.js'
export { BasicZhEventAdapter } from './event-adapter.js'
export * from '@ppl/runtime'

export const name = 'ppl-runtime'
export const inject = ['agents']
export const PPL_STATIC_SECTION = 'ppl:static-persona'
export const PPL_STATIC_ORDER = PERSONA_ORDER + 1

function debug(config, event, data = {}) {
  try { config?.debugSink?.({ source: 'ppl-adapter-dsh', event, ...data }) } catch {}
}

export const defaultPersonaIrPath = fileURLToPath(new URL('../reference/zhuang_fangyi.pir.json', import.meta.url))

export function loadPersonaIr(path = defaultPersonaIrPath) {
  const raw = JSON.parse(readFileSync(resolvePath(path), 'utf8'))
  if (raw?.schema !== 'ppl.persona-ir/0.3') throw new Error(`ppl-runtime: expected PPL 0.3 Persona IR, got ${String(raw?.schema)}`)
  return raw
}

export function apply(ctx, config = {}) {
  const bridge = new PplDshBridge({
    persona: loadPersonaIr(config.personaIr),
    scene: config.scene,
    context: config.context,
    profile: config.profile ?? 'standard',
    commitReasons: config.commitReasons,
  })
  const staticSections = new WeakMap()

  ctx.on('agent/session-start', ({ agent, source }) => {
    debug(config, 'session-start', { agentId: String(agent.id), startSource: source, eventCount: agent.session.events.length })
    bridge.assertSessionBinding(agent.session.events)
    staticSections.get(agent)?.()
    const text = bridge.staticPrompt(agent.session.events, agent.id)
    const dispose = agent.ctx.systemPrompt.section({ name: PPL_STATIC_SECTION, order: PPL_STATIC_ORDER, text })
    staticSections.set(agent, dispose)
    debug(config, 'static-persona-registered', { agentId: String(agent.id), section: PPL_STATIC_SECTION, textLength: text.length })
  })

  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
    debug(config, 'pre-step-enter', { agentId: String(agent.id), turn, step, inputEventCount: agent.session.events.length })
    const decision = await next()
    debug(config, 'pre-step-after-next', { agentId: String(agent.id), turn, step, decisionKind: decision?.kind })
    if (decision.kind === 'reject' || signal.aborted) return decision

    const prepared = bridge.prepareStep({ events: agent.session.events, sessionId: agent.id, turn, step, messages: decision.messages })
    if (!prepared) return decision
    debug(config, 'prepare-step-ok', { agentId: String(agent.id), turn, step, eventType: prepared.event?.type, activeRules: prepared.resolution?.activeRules?.map(r => r.id) ?? [] })

    const source = {
      kind: 'plugin',
      plugin: name,
      form: 'snapshot',
      sections: [{ name: 'ppl:dynamic', text: prepared.dynamicPrompt }],
      ppl: prepared.metadata,
    }
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({ content: [{ type: 'text', text: prepared.dynamicPrompt }], source }),
      ],
    }
  }, { prepend: true })
}
