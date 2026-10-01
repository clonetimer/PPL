import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { clone, resolveProfileEventGeneric, finalizeProfileResolution, makeProfileSnapshot } from '@ppl/profile-core'
import { MemoryRecordStore, SessionRepository, AuditRepository, fingerprint } from '@ppl/platform-core'

const PROFILE = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../profiles/character.profile.json', import.meta.url)), 'utf8'))
const now = () => new Date().toISOString()
const uid = prefix => `${prefix}_${crypto.randomUUID()}`
export const PPL_PRODUCT_CHARACTER_SESSION_SCHEMA = 'ppl.product.character-session/1'

export class CharacterGovernanceService {
  constructor(options = {}) {
    this.profile = clone(options.profile || PROFILE)
    this.store = options.store || new MemoryRecordStore()
    this.sessionsRepo = options.sessionsRepo || new SessionRepository(this.store, 'character')
    this.auditRepo = options.auditRepo || new AuditRepository(this.store, 'character')
  }

  createSession(input = {}) {
    const sessionId = String(input.sessionId || uid('character'))
    if (this.sessionsRepo.get(sessionId)) throw new Error(`session already exists: ${sessionId}`)
    const at = now()
    const session = {
      schema: PPL_PRODUCT_CHARACTER_SESSION_SCHEMA,
      sessionId,
      characterId: input.characterId ? String(input.characterId) : null,
      userId: input.userId ? String(input.userId) : null,
      createdAt: at,
      updatedAt: at,
      state: clone(this.profile.initialState),
      snapshots: [],
      processedEvents: {},
      audit: [],
      metadata: clone(input.metadata || {}),
    }
    const row = this.sessionsRepo.create(sessionId, session)
    const event = this.#audit(session, 'session.created', { characterId: session.characterId, userId: session.userId })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: event.eventId, type: event.type, payload: event.data, at: event.at })
    return clone(session)
  }

  listSessions() { return this.sessionsRepo.list().map(row => ({ sessionId: row.id, characterId: row.value.characterId, userId: row.value.userId, state: clone(row.value.state), updatedAt: row.value.updatedAt })) }
  getSession(sessionId) { return clone(this.#require(sessionId).value) }
  getAudit(sessionId) { return clone(this.#require(sessionId).value.audit) }

  applyEvent(sessionId, input = {}) {
    const type = String(input.type || '').trim()
    if (!type) throw new Error('event type required')
    const event = { id: String(input.eventId || uid('character-event')), type, payload: clone(input.payload || {}) }
    const row = this.#require(sessionId); const session = row.value
    const fp = fingerprint(event)
    if (session.processedEvents[event.id]) {
      if (session.processedEvents[event.id] !== fp) {
        const error = new Error(`event id reused with different payload: ${event.id}`); error.code = 'IDEMPOTENCY_CONFLICT'; throw error
      }
      return { duplicate: true, state: clone(session.state) }
    }
    const resolution = resolveProfileEventGeneric(this.profile, session.state, event, { product: 'character-governance' })
    const finalized = finalizeProfileResolution(this.profile, session.state, resolution, 'completed')
    const snapshot = makeProfileSnapshot(this.profile, { turn: session.snapshots.length + 1, step: 1 }, event, resolution, 'completed')
    session.state = clone(finalized.state)
    session.snapshots.push(snapshot)
    session.processedEvents[event.id] = fp
    const audit = this.#audit(session, finalized.committed ? 'event.applied' : 'event.blocked', { eventId: event.id, eventType: type, mutations: resolution.mutations })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: audit.eventId, type: audit.type, payload: audit.data, at: audit.at })
    return { duplicate: false, committed: finalized.committed, state: clone(session.state), resolution: clone(resolution) }
  }

  comfort(sessionId, input = {}) { return this.applyEvent(sessionId, { eventId: input.eventId, type: 'COMFORT', payload: input.payload || {} }) }
  confess(sessionId, input = {}) { return this.applyEvent(sessionId, { eventId: input.eventId, type: 'CONFESSION', payload: input.payload || {} }) }

  #require(sessionId) { const row = this.sessionsRepo.get(String(sessionId)); if (!row) throw new Error(`unknown session: ${sessionId}`); return row }
  #audit(session, type, data) { const event = { eventId: uid('audit'), at: now(), type, data: clone(data) }; session.audit.push(event); session.updatedAt = event.at; return event }
  close() { this.store?.close?.() }
}
