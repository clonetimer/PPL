import type {
  ConversationNodeDefinition,
  ConversationViewBuilder,
  ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  PPL_INSPECTOR_TARGET,
  type PplHostSnapshot,
  type PplInspectorConversationViewNode,
  type PplInspectorSnapshot,
  type PplInspectorSnapshotConversationViewNode,
  type PplInspectorTurnEndConversationViewNode,
} from './contracts.ts'
import { parsePplSnapshotFromEvent, parseTurnEndFromEvent } from './parse.ts'

function snapshotId(turn: number, step: number): string {
  return `turn:${turn}:step:${step}`
}

function turnEndId(turn: number): string {
  return `turn:${turn}`
}

/** One context per durable PPL resolution snapshot, including step>1 steering. */
export const pplSnapshotDefinition: ConversationNodeDefinition<{
  readonly snapshot: PplHostSnapshot
  readonly snapshotSeq: number
}> = {
  kind: 'ppl-persona-snapshot',
  target: PPL_INSPECTOR_TARGET,
  match(event) {
    const snapshot = parsePplSnapshotFromEvent(event)
    return snapshot === undefined
      ? null
      : { id: snapshotId(snapshot.host.turn, snapshot.host.step), role: 'start' }
  },
  start(_context, match) {
    const snapshot = parsePplSnapshotFromEvent(match.event)
    if (snapshot === undefined) throw new Error('ppl-persona-snapshot requires a PPL host snapshot start')
    return { snapshot, snapshotSeq: match.event.seq }
  },
  update(context) {
    return context.state
  },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'ppl-persona-snapshot',
      id: context.id,
      target: PPL_INSPECTOR_TARGET,
      data: context.state,
    } satisfies PplInspectorSnapshotConversationViewNode
  },
}

/** One independent turn-end context; the view builder joins it to every snapshot in that turn. */
export const pplTurnEndDefinition: ConversationNodeDefinition<{
  readonly turn: number
  readonly endSeq: number
  readonly endReason: string
  readonly endError?: string
}> = {
  kind: 'ppl-persona-turn-end',
  target: PPL_INSPECTOR_TARGET,
  match(event) {
    const end = parseTurnEndFromEvent(event)
    return end === undefined ? null : { id: turnEndId(end.turn), role: 'start' }
  },
  start(_context, match) {
    const end = parseTurnEndFromEvent(match.event)
    if (end === undefined) throw new Error('ppl-persona-turn-end requires a turn/end start')
    return {
      turn: end.turn,
      endSeq: match.event.seq,
      endReason: end.reason,
      ...(end.error === undefined ? {} : { endError: end.error }),
    }
  },
  update(context) {
    return context.state
  },
  buildViewNode(context) {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'ppl-persona-turn-end',
      id: context.id,
      target: PPL_INSPECTOR_TARGET,
      data: context.state,
    } satisfies PplInspectorTurnEndConversationViewNode
  },
}

/** @deprecated RC1 split one-turn contexts into snapshot + turn-end contexts. */
export const pplTurnDefinition = pplSnapshotDefinition

const EMPTY_ENTRIES = [] as const
export const EMPTY_PPL_INSPECTOR_SNAPSHOT: PplInspectorSnapshot = {
  entries: EMPTY_ENTRIES,
  latest: null,
}

class PplInspectorSnapshotBuilder implements ConversationViewBuilder<
  PplInspectorConversationViewNode,
  PplInspectorSnapshot
> {
  readonly empty = EMPTY_PPL_INSPECTOR_SNAPSHOT
  private readonly nodes = new Map<string, PplInspectorConversationViewNode>()

  replace(input: { readonly nodes: readonly PplInspectorConversationViewNode[] }): PplInspectorSnapshot {
    this.nodes.clear()
    for (const node of input.nodes) this.nodes.set(node.key, node)
    return this.snapshot()
  }

  apply(input: { readonly upserts: readonly PplInspectorConversationViewNode[] }): PplInspectorSnapshot {
    for (const node of input.upserts) this.nodes.set(node.key, node)
    return this.snapshot()
  }

  private snapshot(): PplInspectorSnapshot {
    const endings = new Map<number, PplInspectorTurnEndConversationViewNode['data']>()
    for (const node of this.nodes.values()) {
      if (node.kind === 'ppl-persona-turn-end') endings.set(node.data.turn, node.data)
    }

    const entries = [...this.nodes.values()]
      .flatMap(node => {
        if (node.kind !== 'ppl-persona-snapshot') return []
        const ending = endings.get(node.data.snapshot.host.turn)
        return [{
          snapshot: node.data.snapshot,
          snapshotSeq: node.data.snapshotSeq,
          ...(ending === undefined ? {} : {
            endSeq: ending.endSeq,
            endReason: ending.endReason,
            ...(ending.endError === undefined ? {} : { endError: ending.endError }),
          }),
        }]
      })
      .sort((left, right) => left.snapshotSeq - right.snapshotSeq)

    return {
      entries,
      latest: entries.at(-1) ?? null,
    }
  }
}

export const pplInspectorViewDefinition: ConversationViewDefinition<
  PplInspectorConversationViewNode,
  PplInspectorSnapshot
> = {
  target: PPL_INSPECTOR_TARGET,
  create: () => new PplInspectorSnapshotBuilder(),
}
