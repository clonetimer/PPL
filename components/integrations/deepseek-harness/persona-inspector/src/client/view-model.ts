import type {
  PplCommit,
  PplHostSnapshot,
  PplInspectorTurnState,
  PplTraceEntry,
  PplTransition,
} from './contracts.ts'

export type MutationStatus = 'pending' | 'applied' | 'discarded'

export interface InspectorMutation {
  readonly kind: 'commit' | 'transition'
  readonly source: string
  readonly path: string
  readonly from: unknown
  readonly to: unknown
  readonly status: MutationStatus
}

export interface InspectorRelationshipRow {
  readonly path: string
  readonly label: string
  readonly value: unknown
  readonly projected?: unknown
  readonly projectedStatus?: MutationStatus
}

export interface InspectorTraceRow {
  readonly path: string
  readonly base: unknown
  readonly final: unknown
  readonly baseBand?: string
  readonly finalBand?: string
  readonly delta?: number
  readonly deltaMagnitude?: string
  readonly steps: readonly {
    readonly rule: string
    readonly priority?: number
    readonly op: string
    readonly value: unknown
    readonly before: unknown
    readonly after: unknown
  }[]
}

export const DSH_COMMIT_END_REASONS = new Set(['completed', 'max-tokens'])

export function mutationStatus(entry: PplInspectorTurnState): MutationStatus {
  if (entry.endReason === undefined) return 'pending'
  return DSH_COMMIT_END_REASONS.has(entry.endReason) ? 'applied' : 'discarded'
}


function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function relationshipFields(snapshot: PplHostSnapshot): InspectorRelationshipRow[] {
  const resolved = record(snapshot.resolution.resolved)
  const relationships = record(resolved?.relationships)
  if (relationships === undefined) return []
  const rows: InspectorRelationshipRow[] = []
  for (const [relationship, raw] of Object.entries(relationships)) {
    const values = record(raw)
    if (values === undefined) continue
    for (const [field, value] of Object.entries(values)) {
      if (record(value) !== undefined) continue
      rows.push({
        path: `relationships.${relationship}.${field}`,
        label: `${relationship}.${field}`,
        value,
      })
    }
  }
  return rows
}

function mutationRows(entry: PplInspectorTurnState): InspectorMutation[] {
  const status = mutationStatus(entry)
  const commits = entry.snapshot.resolution.pendingCommits ?? []
  const transitions = entry.snapshot.resolution.pendingTransitions ?? []
  return [
    ...commits.map((mutation: PplCommit): InspectorMutation => ({
      kind: 'commit',
      source: mutation.source ?? 'commit',
      path: mutation.path ?? 'unknown',
      from: mutation.from,
      to: mutation.projected ?? mutation.value,
      status,
    })),
    ...transitions.map((mutation: PplTransition): InspectorMutation => ({
      kind: 'transition',
      source: mutation.source ?? 'transition',
      path: mutation.path ?? 'unknown',
      from: mutation.from,
      to: mutation.to,
      status,
    })),
  ]
}

export function relationshipRows(entry: PplInspectorTurnState): InspectorRelationshipRow[] {
  const rows = relationshipFields(entry.snapshot)
  const byPath = new Map(rows.map(row => [row.path, row]))
  for (const mutation of mutationRows(entry)) {
    const current = byPath.get(mutation.path)
    if (current === undefined) continue
    byPath.set(mutation.path, {
      ...current,
      projected: mutation.to,
      projectedStatus: mutation.status,
    })
  }
  return [...byPath.values()]
}

export function mutations(entry: PplInspectorTurnState): readonly InspectorMutation[] {
  return mutationRows(entry)
}

function normalizeTrace(path: string, trace: PplTraceEntry): InspectorTraceRow | undefined {
  if (trace.base === undefined && trace.final === undefined) return undefined
  const steps = (trace.steps ?? []).map(step => ({
    rule: step.rule ?? 'unknown-rule',
    ...(step.priority === undefined ? {} : { priority: step.priority }),
    op: step.op ?? '?',
    value: step.value,
    before: step.before,
    after: step.after,
  }))
  return {
    path: trace.path ?? path,
    base: trace.base,
    final: trace.final,
    ...(trace.baseBand === undefined ? {} : { baseBand: trace.baseBand }),
    ...(trace.finalBand === undefined ? {} : { finalBand: trace.finalBand }),
    ...(trace.delta === undefined ? {} : { delta: trace.delta }),
    ...(trace.deltaMagnitude === undefined ? {} : { deltaMagnitude: trace.deltaMagnitude }),
    steps,
  }
}

export function changedTraces(entry: PplInspectorTurnState): readonly InspectorTraceRow[] {
  const trace = entry.snapshot.resolution.trace ?? {}
  return Object.entries(trace)
    .flatMap(([path, value]) => {
      const normalized = normalizeTrace(path, value)
      if (normalized === undefined) return []
      if (normalized.delta === 0 && normalized.steps.length === 0) return []
      return [normalized]
    })
    .sort((left, right) => Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0))
}

export function formatValue(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null) return 'null'
  if (value === undefined) return '—'
  try { return JSON.stringify(value) } catch { return String(value) }
}
