import type { ConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'

export const PPL_INSPECTOR_TARGET = 'ppl-inspector' as const
export const PPL_HOST_SNAPSHOT_SCHEMA = 'ppl.host-snapshot/0.1' as const
export const PPL_PLUGIN_NAME = 'ppl-runtime' as const

export interface PplRuleRef {
  readonly id: string
  readonly priority?: number
}

export interface PplTraceStep {
  readonly rule?: string
  readonly priority?: number
  readonly op?: string
  readonly value?: unknown
  readonly before?: unknown
  readonly after?: unknown
}

export interface PplTraceEntry {
  readonly path?: string
  readonly base?: unknown
  readonly baseBand?: string
  readonly steps?: readonly PplTraceStep[]
  readonly raw?: unknown
  readonly final?: unknown
  readonly finalBand?: string
  readonly delta?: number
  readonly deltaMagnitude?: string
}

export interface PplCommit {
  readonly source?: string
  readonly op?: string
  readonly path?: string
  readonly value?: unknown
  readonly from?: unknown
  readonly projected?: unknown
}

export interface PplTransition {
  readonly source?: string
  readonly path?: string
  readonly from?: unknown
  readonly to?: unknown
}

export interface PplHostResolution {
  readonly schema: string
  readonly coreSchema?: string
  readonly activeRules?: readonly PplRuleRef[]
  readonly activeTransitions?: readonly unknown[]
  readonly resolved?: Readonly<Record<string, unknown>>
  readonly trace?: Readonly<Record<string, PplTraceEntry>>
  readonly pendingCommits?: readonly PplCommit[]
  readonly pendingTransitions?: readonly PplTransition[]
  readonly invariantResults?: readonly unknown[]
  readonly diagnostics?: readonly unknown[]
  readonly valid?: boolean
}

export interface PplHostSnapshot {
  readonly schema: typeof PPL_HOST_SNAPSHOT_SCHEMA
  readonly persona: {
    readonly id: string
    readonly version?: string
    readonly irSha256: string
  }
  readonly host: {
    readonly kind: string
    readonly turn: number
    readonly step: number
  }
  readonly turn?: number
  readonly step?: number
  readonly event?: Readonly<Record<string, unknown>>
  readonly context?: Readonly<Record<string, unknown>>
  readonly resolution: PplHostResolution
}

/** One durable PPL resolution snapshot, decorated with its owning turn outcome. */
export interface PplInspectorTurnState {
  readonly snapshot: PplHostSnapshot
  readonly snapshotSeq: number
  readonly endSeq?: number
  readonly endReason?: string
  readonly endError?: string
}

export interface PplInspectorSnapshotConversationViewNode extends ConversationViewNode {
  readonly kind: 'ppl-persona-snapshot'
  readonly target: typeof PPL_INSPECTOR_TARGET
  readonly data: {
    readonly snapshot: PplHostSnapshot
    readonly snapshotSeq: number
  }
}

export interface PplInspectorTurnEndConversationViewNode extends ConversationViewNode {
  readonly kind: 'ppl-persona-turn-end'
  readonly target: typeof PPL_INSPECTOR_TARGET
  readonly data: {
    readonly turn: number
    readonly endSeq: number
    readonly endReason: string
    readonly endError?: string
  }
}

export type PplInspectorConversationViewNode =
  | PplInspectorSnapshotConversationViewNode
  | PplInspectorTurnEndConversationViewNode

export interface PplInspectorSnapshot {
  readonly entries: readonly PplInspectorTurnState[]
  readonly latest: PplInspectorTurnState | null
}

/**
 * Read the PPL inspector view without globally augmenting Harness'
 * ConversationViewSnapshotMap. Out-of-tree plugins must not widen the host
 * snapshot map because existing generic mocks may assume a closed key set.
 */
export function getPplInspectorSnapshot(views: unknown): PplInspectorSnapshot | undefined {
  const reader = views as { readonly get: (target: string) => unknown }
  return reader.get(PPL_INSPECTOR_TARGET) as PplInspectorSnapshot | undefined
}
