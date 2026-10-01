import { SessionRepository, fingerprint } from '@ppl/platform-core'

export class ExecutionRunRepository {
  constructor(store, namespace = 'execution') { this.repo = new SessionRepository(store, namespace) }
  create(run) { return this.repo.create(run.runId, run) }
  get(runId) { return this.repo.get(String(runId)) }
  save(run, revision) { return this.repo.save(run.runId, run, revision) }
  list() { return this.repo.list() }
}

/**
 * Adapter from the shared PPL RecordStore to the Stable Host ToolExecutionLedger store contract.
 *
 * This makes completed tool-call ledger entries survive normal process restarts when the
 * product store is SQLite. It does not by itself close the crash window between an external
 * side effect and ledger persistence; crash-window recovery remains a stronger Host lifecycle
 * concern and is intentionally not overclaimed here.
 */
export class RecordStoreToolExecutionStore {
  constructor(store, namespace = 'tool-execution') {
    if (!store) throw new Error('RecordStoreToolExecutionStore requires store')
    this.store = store
    this.namespace = String(namespace)
  }

  async get(callId) {
    return this.store.get(this.namespace, String(callId))?.value || null
  }

  async set(callId, entry) {
    const id = String(callId)
    const current = this.store.get(this.namespace, id)
    if (!current) {
      try { this.store.create(this.namespace, id, entry); return }
      catch (error) {
        // A concurrent writer may have inserted the same id after our read.
        const raced = this.store.get(this.namespace, id)
        if (!raced) throw error
        if (fingerprint(raced.value) !== fingerprint(entry)) throw new Error(`tool ledger race conflict: ${id}`)
        return
      }
    }
    this.store.save(this.namespace, id, entry, { expectedRevision: current.revision })
  }

  async delete(callId) {
    // Shared RecordStore deliberately has no destructive delete API. Tool ledger entries are
    // append/preserve semantics in the product plane, so deletion is unsupported by design.
    throw new Error(`tool ledger deletion is unsupported for ${String(callId)}`)
  }

  async size() {
    return this.store.list(this.namespace).length
  }
}
