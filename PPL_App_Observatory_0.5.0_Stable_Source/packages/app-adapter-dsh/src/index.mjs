import { normalizeSession, validateSession } from '@ppl/app-core'

const SNAPSHOT_SCHEMAS = new Set(['ppl.host-snapshot/0.1', 'ppl.profile-snapshot/0.1', 'ppl.profile-snapshot/0.2'])
const APP_SESSION_SCHEMAS = new Set(['ppl.app-session/0.1', 'ppl.app-session/0.2', 'ppl.app-session/0.3'])

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function isProfileSnapshot(snapshot) { return snapshot?.schema === 'ppl.profile-snapshot/0.1' || snapshot?.schema === 'ppl.profile-snapshot/0.2' }

function findSnapshot(value) {
  if (!isRecord(value)) return undefined
  if (SNAPSHOT_SCHEMAS.has(value.schema)) return value
  for (const candidate of [value.snapshot, value.ppl, value.source?.ppl, value.metadata?.ppl]) {
    if (!candidate) continue
    if (SNAPSHOT_SCHEMAS.has(candidate.schema)) return candidate
    if (SNAPSHOT_SCHEMAS.has(candidate.snapshot?.schema)) return candidate.snapshot
  }
  return undefined
}

function collectRecords(input) {
  const records = []
  const seen = new Set()
  const add = value => {
    if (!isRecord(value) || seen.has(value)) return
    seen.add(value)
    records.push(value)
  }
  if (Array.isArray(input)) input.forEach(add)
  if (isRecord(input)) {
    add(input)
    for (const key of ['messages', 'events', 'entries', 'records', 'items']) if (Array.isArray(input[key])) input[key].forEach(add)
    if (isRecord(input.session)) {
      add(input.session)
      for (const key of ['messages', 'events', 'entries', 'records']) if (Array.isArray(input.session[key])) input.session[key].forEach(add)
    }
  }
  return records
}

function turnEndMap(records) {
  const map = new Map()
  for (const record of records) {
    const type = record.type || record.kind || record.event?.type
    const turn = record.turn ?? record.host?.turn ?? record.event?.turn
    const reason = record.reason?.kind || record.reason || record.endReason || record.event?.reason?.kind || record.event?.reason
    if (Number.isInteger(turn) && typeof type === 'string' && /turn[\/_-]?end|turn\/end/i.test(type) && reason) map.set(turn, reason)
  }
  return map
}

export function projectDshSession(input, options = {}) {
  if (input?.schema === 'ppl.app-evidence-bundle/0.1') return normalizeSession(input.session)
  if (APP_SESSION_SCHEMAS.has(input?.schema)) return normalizeSession(input)

  const records = collectRecords(input)
  const endByTurn = turnEndMap(records)
  const entries = []
  const seenKey = new Set()
  for (const record of records) {
    const snapshot = findSnapshot(record)
    if (!snapshot) continue
    const turn = snapshot.host?.turn
    const step = snapshot.host?.step
    const key = `${snapshot.schema}:${turn}:${step}:${snapshot.persona?.id || snapshot.profile?.id || ''}`
    if (seenKey.has(key)) continue
    seenKey.add(key)
    const ppl = record.source?.ppl || record.ppl || {}
    const endReason = record.endReason || ppl.endReason || endByTurn.get(turn) || snapshot.transaction?.endReason
    entries.push({ snapshotSeq: entries.length + 1, kind: isProfileSnapshot(snapshot) ? 'profile' : 'persona', ...(endReason ? { endReason } : {}), snapshot })
  }

  const firstProfile = entries.find(entry => entry.kind === 'profile')?.snapshot?.profile
  const session = firstProfile
    ? {
        schema: 'ppl.app-session/0.3',
        title: options.title || input?.title || input?.session?.title || 'DeepSeek Harness · PPL Profile Session',
        profile: {
          id: firstProfile.id,
          title: firstProfile.title || firstProfile.id,
          kind: firstProfile.kind,
          version: firstProfile.version,
          ...(firstProfile.engine ? { engine: firstProfile.engine } : {}),
        },
        domain: { profileKind: firstProfile.kind, ...(firstProfile.engine ? { engine: firstProfile.engine } : {}) },
        entries,
      }
    : {
        schema: 'ppl.app-session/0.2',
        title: options.title || input?.title || input?.session?.title || 'DeepSeek Harness · PPL Session',
        entries,
      }
  const errors = validateSession(session)
  if (errors.length) throw new Error(`Unable to project DSH session:\n${errors.join('\n')}`)
  return normalizeSession(session)
}
