import {
  PPL_HOST_SNAPSHOT_SCHEMA,
  isPplSnapshotSchema,
  existingPersonaBindingFromLifecycle,
  projectRuntimeFromLifecycle,
} from '@ppl/runtime'

export const PPL_PLUGIN_NAME = 'ppl-runtime'
export const PPL_SNAPSHOT_SCHEMA = PPL_HOST_SNAPSHOT_SCHEMA

export function snapshotMetaFromDshEvent(event) {
  if (event?.type !== 'user/message') return undefined
  const source = event.data?.source
  if (!source || source.kind !== 'plugin' || source.plugin !== PPL_PLUGIN_NAME) return undefined
  const ppl = source.ppl
  if (!ppl || !isPplSnapshotSchema(ppl.schema)) return undefined
  return ppl
}

/**
 * Backward-compatible Host Adapter facade retained from the integration spike.
 * @deprecated Prefer snapshotMetaFromDshEvent() in new code.
 */
export const snapshotMetaFromEvent = snapshotMetaFromDshEvent

export function dshEventsToPplLifecycle(events) {
  const out = []
  for (const event of events) {
    const snapshot = snapshotMetaFromDshEvent(event)
    if (snapshot) {
      out.push({ kind: 'snapshot', snapshot })
      continue
    }
    if (event?.type === 'turn/end') {
      out.push({
        kind: 'turn-end',
        turn: Number(event.data?.turn),
        reason: String(event.data?.reason?.kind ?? ''),
      })
    }
  }
  return out
}

export function existingPersonaBinding(events) {
  return existingPersonaBindingFromLifecycle(dshEventsToPplLifecycle(events))
}

export function projectRuntimeFromSession(ir, events, sessionId = 'dsh-session', options = {}) {
  return projectRuntimeFromLifecycle(ir, dshEventsToPplLifecycle(events), sessionId, options)
}
