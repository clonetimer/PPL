import { applyResolution } from '../vendor/pplc/runtime.js'
import { isPplSnapshotSchema } from './host-snapshot.js'

export const DEFAULT_COMMIT_REASONS = Object.freeze(['completed'])

export function normalizeHostLifecycleEvent(event) {
  if (!event || typeof event !== 'object') return undefined
  if (event.kind === 'snapshot' && event.snapshot && isPplSnapshotSchema(event.snapshot.schema)) {
    return { kind: 'snapshot', snapshot: event.snapshot }
  }
  if (event.kind === 'turn-end') {
    return { kind: 'turn-end', turn: Number(event.turn), reason: String(event.reason ?? '') }
  }
  return undefined
}

export function existingPersonaBindingFromLifecycle(events) {
  let binding
  for (const raw of events) {
    const event = normalizeHostLifecycleEvent(raw)
    if (event?.kind !== 'snapshot') continue
    const next = event.snapshot.persona
    if (!binding) binding = next
    else if (binding.id !== next.id || binding.irSha256 !== next.irSha256) {
      throw new Error(`PPL session contains conflicting persona bindings: ${binding.id}@${binding.irSha256.slice(0, 12)} and ${next.id}@${next.irSha256.slice(0, 12)}`)
    }
  }
  return binding
}

function owningTurn(snapshot) {
  const turn = Number(snapshot.host?.turn ?? snapshot.turn)
  if (!Number.isFinite(turn)) throw new Error('PPL snapshot is missing a numeric owning turn')
  return turn
}

function owningStep(snapshot) {
  // Legacy 0.1 DSH snapshots predate host.step in some fixtures. They were
  // one-snapshot-per-turn, so step 1 is the only compatible interpretation.
  const step = Number(snapshot.host?.step ?? snapshot.step ?? 1)
  if (!Number.isFinite(step) || step < 1) throw new Error('PPL snapshot is missing a positive numeric owning step')
  return step
}

function applyHostSnapshot(runtime, snapshot, sessionId, turn) {
  const applied = applyResolution(runtime, snapshot.resolution)
  return {
    ...applied,
    session: {
      ...(applied.session ?? {}),
      id: String(sessionId),
      // Multiple PPL resolutions may occur inside one host turn (for example
      // human steering at step>1). Host turn, not resolution count, owns the
      // durable session cursor.
      turn,
    },
  }
}

function applySnapshots(runtime, snapshots, sessionId, turn) {
  let next = runtime
  for (const snapshot of snapshots) next = applyHostSnapshot(next, snapshot, sessionId, turn)
  return next
}

/**
 * Reconstruct PPL runtime state from host lifecycle events.
 *
 * Default projection is committed-only. `includePending: true` additionally
 * applies the one currently-open host turn transactionally in snapshot order;
 * this is used only to resolve later human steering in that same turn. A
 * non-committing turn/end discards every staged resolution from the turn.
 */
export function projectRuntimeFromLifecycle(ir, events, sessionId = 'ppl-session', options = {}) {
  void ir // retained for API compatibility and future schema-aware projection
  const commitsOn = new Set(options.commitReasons ?? DEFAULT_COMMIT_REASONS)
  let runtime = { session: { id: String(sessionId), turn: 0 } }
  const pendingByTurn = new Map()

  for (const raw of events) {
    const event = normalizeHostLifecycleEvent(raw)
    if (!event) continue

    if (event.kind === 'snapshot') {
      const turn = owningTurn(event.snapshot)
      const step = owningStep(event.snapshot)
      const entries = pendingByTurn.get(turn) ?? []
      if (entries.some(entry => entry.step === step)) {
        throw new Error(`PPL invariant: more than one persona snapshot recorded for host turn ${turn} step ${step}`)
      }
      if (entries.length > 0 && step <= entries[entries.length - 1].step) {
        throw new Error(`PPL invariant: persona snapshots for host turn ${turn} are not in increasing step order`)
      }
      entries.push({ step, snapshot: event.snapshot })
      pendingByTurn.set(turn, entries)
      continue
    }

    const entries = pendingByTurn.get(event.turn)
    if (!entries) continue
    if (commitsOn.has(event.reason)) {
      runtime = applySnapshots(runtime, entries.map(entry => entry.snapshot), sessionId, event.turn)
    }
    pendingByTurn.delete(event.turn)
  }

  if (options.includePending === true && pendingByTurn.size > 0) {
    if (pendingByTurn.size > 1) {
      throw new Error(`PPL invariant: more than one host turn is open (${[...pendingByTurn.keys()].join(', ')})`)
    }
    const [[turn, entries]] = [...pendingByTurn.entries()]
    runtime = applySnapshots(runtime, entries.map(entry => entry.snapshot), sessionId, turn)
  }

  return runtime
}
