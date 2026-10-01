import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { clone, finalizeProfileResolution, makeProfileSnapshot, setPath } from '@ppl/profile-core'
import { resolveTutorEvent, summarizeTutorState } from '@ppl/profile-tutor'
import { MemoryRecordStore, SessionRepository, AuditRepository, fingerprint } from '@ppl/platform-core'

export const PPL_PRODUCT_TUTOR_SESSION_SCHEMA = 'ppl.product.tutor-session/1'
const PROFILE = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../profiles/tutor.profile.json', import.meta.url)), 'utf8'))
const now = () => new Date().toISOString()
const id = prefix => `${prefix}_${crypto.randomUUID()}`

export class TutorGovernanceService {
  constructor(options = {}) {
    this.profile = clone(options.profile || PROFILE)
    this.store = options.store || new MemoryRecordStore()
    this.sessionsRepo = options.sessionsRepo || new SessionRepository(this.store, 'tutor')
    this.auditRepo = options.auditRepo || new AuditRepository(this.store, 'tutor')
  }

  createSession(input = {}) {
    const sessionId = String(input.sessionId || id('tutor'))
    if (this.sessionsRepo.get(sessionId)) throw new Error(`session already exists: ${sessionId}`)
    const at = now()
    const state = clone(this.profile.initialState)
    if (input.skillId) {
      setPath(state, 'learner.currentSkillId', String(input.skillId))
      setPath(state, 'learner.currentSkillKey', String(input.skillId).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown')
    }
    const session = {
      schema: PPL_PRODUCT_TUTOR_SESSION_SCHEMA,
      sessionId,
      learnerId: input.learnerId ? String(input.learnerId) : null,
      status: 'active',
      createdAt: at,
      updatedAt: at,
      state,
      snapshots: [],
      processedEvents: {},
      audit: [],
      metadata: clone(input.metadata || {}),
    }
    const row = this.sessionsRepo.create(sessionId, session)
    this.#auditAndSave(row, session, 'session.created', { learnerId: session.learnerId })
    return clone(session)
  }

  listSessions() {
    return this.sessionsRepo.list().map(row => ({
      sessionId: row.id,
      learnerId: row.value.learnerId,
      status: row.value.status,
      currentSkillId: row.value.state?.learner?.currentSkillId,
      updatedAt: row.value.updatedAt,
    }))
  }

  getSession(sessionId) { return clone(this.#require(sessionId).value) }
  getSummary(sessionId) { return summarizeTutorState(this.#require(sessionId).value.state) }
  getAudit(sessionId) { return clone(this.#require(sessionId).value.audit) }

  observe(sessionId, input = {}) {
    return this.#apply(sessionId, {
      id: String(input.eventId || input.evidenceId || id('observation')),
      type: 'LEARNER_OBSERVATION',
      payload: { ...clone(input), evidenceId: String(input.evidenceId || input.eventId || '') || undefined },
    })
  }

  observeAffect(sessionId, input = {}) {
    return this.#apply(sessionId, { id: String(input.eventId || id('affect')), type: 'AFFECT_OBSERVED', payload: clone(input) })
  }

  recordIntervention(sessionId, input = {}) {
    const interventionId = String(input.interventionId || input.eventId || id('intervention'))
    return this.#apply(sessionId, { id: String(input.eventId || interventionId), type: 'INTERVENTION_APPLIED', payload: { ...clone(input), interventionId } })
  }

  verifyIntervention(sessionId, input = {}) {
    if (!input.interventionId) throw new Error('interventionId required')
    return this.#apply(sessionId, { id: String(input.eventId || id('verification')), type: 'TURN_VERIFIED', payload: clone(input) })
  }

  #apply(sessionId, event) {
    const row = this.#require(sessionId)
    const session = row.value
    const eventFingerprint = fingerprint(event)
    const prior = session.processedEvents[event.id]
    if (prior) {
      if (prior !== eventFingerprint) {
        const error = new Error(`event id reused with different payload: ${event.id}`)
        error.code = 'IDEMPOTENCY_CONFLICT'
        throw error
      }
      return { duplicate: true, eventId: event.id, summary: summarizeTutorState(session.state), state: clone(session.state) }
    }
    const resolution = resolveTutorEvent(this.profile, session.state, event, { product: 'tutor-governance' })
    const finalized = finalizeProfileResolution(this.profile, session.state, resolution, 'completed')
    const snapshot = makeProfileSnapshot(this.profile, { turn: session.snapshots.length + 1, step: 1 }, event, resolution, 'completed')
    session.state = finalized.state
    session.snapshots.push(snapshot)
    session.processedEvents[event.id] = eventFingerprint
    session.updatedAt = now()
    session.status = finalized.committed ? 'active' : 'blocked'
    const audit = this.#audit(session, finalized.committed ? 'event.applied' : 'event.blocked', {
      eventId: event.id,
      eventType: event.type,
      committed: finalized.committed,
      diagnostics: resolution.diagnostics,
    })
    const saved = this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: audit.eventId, type: audit.type, payload: audit.data, at: audit.at })
    return { duplicate: false, event: clone(event), resolution: clone(resolution), committed: finalized.committed, revision: saved.revision, summary: summarizeTutorState(session.state) }
  }

  #require(sessionId) {
    const row = this.sessionsRepo.get(String(sessionId))
    if (!row) throw new Error(`unknown session: ${sessionId}`)
    return row
  }

  #audit(session, type, data) {
    const event = { eventId: id('audit'), at: now(), type, data: clone(data) }
    session.audit.push(event)
    session.updatedAt = event.at
    return event
  }

  #auditAndSave(row, session, type, data) {
    const event = this.#audit(session, type, data)
    this.sessionsRepo.save(session.sessionId, session, row.revision)
    this.auditRepo.append(session.sessionId, { eventId: event.eventId, type: event.type, payload: event.data, at: event.at })
  }

  close() { this.store?.close?.() }
}
