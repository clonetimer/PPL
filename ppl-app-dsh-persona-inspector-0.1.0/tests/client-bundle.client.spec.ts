// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ConversationEventRegistry,
  ConversationViewRegistry,
  SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'

const PLUGIN_ID = '@ppl/app-dsh-persona-inspector'

interface Handoff {
  id: string
  factory: (require: (spec: string) => unknown) => Record<string, unknown>
}
type Win = { __ModuleLoader__?: { load(h: Handoff): void } }

function readBundle(): string | undefined {
  try {
    return readFileSync(resolve('packages/client/ui-ppl-inspector/lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

afterEach(() => {
  delete (window as Win).__ModuleLoader__
  for (const element of document.querySelectorAll('style')) element.remove()
})

describe('PPL Persona Inspector tsdown client artifact', () => {
  const code = readBundle()

  async function loadArtifact() {
    let handoff: Handoff | undefined
    ;(window as Win).__ModuleLoader__ = { load: value => { handoff = value } }
    // Deliberately execute the built browser bundle inside the jsdom window,
    // mirroring the Harness ModuleLoader handoff contract.
    // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
    new Function(code!)()
    expect(handoff).toBeDefined()

    const modules = new Map<string, unknown>([
      ['react', await import('react')],
      ['react/jsx-runtime', await import('react/jsx-runtime')],
      ['react-dom', await import('react-dom')],
      ['@deepseek-ai/dsh-client-runtime/client', await import('@deepseek-ai/dsh-client-runtime/client')],
    ])
    const exports = handoff!.factory((specifier) => {
      if (!modules.has(specifier)) throw new Error(`unexpected require: ${specifier}`)
      return modules.get(specifier)
    })
    return { handoff: handoff!, exports }
  }

  it.skipIf(code === undefined)('hands off with the PPL manifest id', async () => {
    const { handoff, exports } = await loadArtifact()
    expect(handoff.id).toBe(PLUGIN_ID)
    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual(['slots', 'conversationEvents', 'conversationViews', 'sessions'])
  })

  it.skipIf(code === undefined)('registers the Persona view into the real conversation ring', async () => {
    const { exports } = await loadArtifact()
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    await ctx.plugin(ConversationEventRegistry).await()
    await ctx.plugin(ConversationViewRegistry).await()
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_props: { renderSlot?: unknown }) => null)
    ctx.provide('sessions', { binding: () => undefined })

    const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void })
    await fiber.await()

    expect(slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['persona'])
    const events = ctx.get('conversationEvents') as ConversationEventRegistry
    const views = ctx.get('conversationViews') as ConversationViewRegistry
    expect(events.entries().map(entry => entry.kind)).toEqual([
      'ppl-persona-snapshot',
      'ppl-persona-turn-end',
    ])
    expect(events.entries().map(entry => entry.target)).toEqual([
      'ppl-inspector',
      'ppl-inspector',
    ])
    expect(views.entries().map(entry => entry.target)).toEqual(['ppl-inspector'])

    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
    expect(events.entries()).toEqual([])
    expect(views.entries()).toEqual([])
  })

  it.skipIf(code === undefined)('injects plugin-tagged module CSS', async () => {
    await loadArtifact()
    const tags = document.querySelectorAll(`style[data-plugin=${JSON.stringify(PLUGIN_ID)}]`)
    expect(tags.length).toBeGreaterThan(0)
  })
})
