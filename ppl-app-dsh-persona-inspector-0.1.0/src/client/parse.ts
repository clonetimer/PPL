import type { PplHostSnapshot } from './contracts.ts'
import { PPL_HOST_SNAPSHOT_SCHEMA, PPL_PLUGIN_NAME } from './contracts.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parsePplSnapshotFromEvent(event: unknown): PplHostSnapshot | undefined {
  if (!isRecord(event) || event.type !== 'user/message') return undefined
  const data = event.data
  if (!isRecord(data)) return undefined
  const source = data.source
  if (!isRecord(source) || source.kind !== 'plugin' || source.plugin !== PPL_PLUGIN_NAME) return undefined
  const ppl = source.ppl
  if (!isRecord(ppl) || ppl.schema !== PPL_HOST_SNAPSHOT_SCHEMA) return undefined
  if (!isRecord(ppl.persona) || typeof ppl.persona.id !== 'string' || typeof ppl.persona.irSha256 !== 'string') return undefined
  if (!isRecord(ppl.host) || typeof ppl.host.turn !== 'number' || typeof ppl.host.step !== 'number') return undefined
  if (!isRecord(ppl.resolution)) return undefined
  return ppl as unknown as PplHostSnapshot
}

export interface PplTurnEnd {
  readonly turn: number
  readonly reason: string
  readonly error?: string
}

export function parseTurnEndFromEvent(event: unknown): PplTurnEnd | undefined {
  if (!isRecord(event) || event.type !== 'turn/end') return undefined
  const data = event.data
  if (!isRecord(data) || typeof data.turn !== 'number') return undefined
  const reason = data.reason
  if (!isRecord(reason) || typeof reason.kind !== 'string') return undefined
  const error = isRecord(reason.error) && typeof reason.error.message === 'string'
    ? reason.error.message
    : undefined
  return {
    turn: data.turn,
    reason: reason.kind,
    ...(error === undefined ? {} : { error }),
  }
}
