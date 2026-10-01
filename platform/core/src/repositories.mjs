export class SessionRepository {
  constructor(store, vertical) { this.store = store; this.namespace = `sessions:${vertical}` }
  create(id, session) { return this.store.create(this.namespace, id, session) }
  get(id) { return this.store.get(this.namespace, id) }
  list() { return this.store.list(this.namespace) }
  save(id, session, revision) { return this.store.save(this.namespace, id, session, { expectedRevision: revision }) }
}

export class AuditRepository {
  constructor(store, vertical) { this.store = store; this.namespace = `audit:${vertical}` }
  append(sessionId, event) { return this.store.appendEvent(this.namespace, sessionId, event) }
  list(sessionId) { return this.store.listEvents(this.namespace, sessionId) }
}

export class EvidenceRepository {
  constructor(store, vertical) { this.store = store; this.namespace = `evidence:${vertical}` }
  put(evidenceId, evidence) {
    const current = this.store.get(this.namespace, evidenceId)
    if (!current) return this.store.create(this.namespace, evidenceId, evidence)
    return this.store.save(this.namespace, evidenceId, evidence, { expectedRevision: current.revision })
  }
  get(evidenceId) { return this.store.get(this.namespace, evidenceId)?.value || null }
  list() { return this.store.list(this.namespace).map(row => row.value) }
}
