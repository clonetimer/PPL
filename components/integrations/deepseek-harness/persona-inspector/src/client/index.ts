import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { pplInspectorViewDefinition, pplSnapshotDefinition, pplTurnEndDefinition } from './definition.ts'
import { getPplInspectorSnapshot } from './contracts.ts'
import { PersonaInspectorView, type PersonaInspectorInjected } from './PersonaInspectorView.tsx'

export const inject = ['slots', 'conversationEvents', 'conversationViews', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(pplSnapshotDefinition)
  ctx.conversationEvents.register(pplTurnEndDefinition)
  ctx.conversationViews.register(pplInspectorViewDefinition)

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'persona',
    order: 20,
    label: 'Persona',
    inject: (sessionId: SessionId): PersonaInspectorInjected => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`ppl-inspector: session "${sessionId}" is unavailable`)
      return {
        loadOlder: async () => {
          const before = getPplInspectorSnapshot(session.getSnapshot().views)
          await session.loadOlder()
          return getPplInspectorSnapshot(session.getSnapshot().views) !== before
        },
      }
    },
  }, PersonaInspectorView))
}

export * from './contracts.ts'
export * from './parse.ts'
export * from './view-model.ts'
