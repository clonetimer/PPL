import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  compileLifeHostRequest,
  validateLifeHostResponse,
  buildLifeHostOwnedMutationFallback,
  applyLifeModelResponse,
  applyLifeHostRisk,
  observeLifeRealtimeFact,
} from '@ppl/host-binding-life'
import { MemoryRecordStore, SessionRepository, AuditRepository, fingerprint } from '@ppl/platform-core'

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const PROFILE = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../profiles/life.profile.json', import.meta.url)), 'utf8'))
const now = () => new Date().toISOString()
const uid = prefix => `${prefix}_${crypto.randomUUID()}`
export const PPL_PRODUCT_LIFE_SESSION_SCHEMA = 'ppl.product.life-session/1'

export class LifeGovernanceService {
  constructor(options = {}) {
    this.profile = clone(options.profile || PROFILE)
    this.store = options.store || new MemoryRecordStore()
    this.sessionsRepo = options.sessionsRepo || new SessionRepository(this.store, 'life')
    this.auditRepo = options.auditRepo || new AuditRepository(this.store, 'life')
  }

  createSession(input = {}) {
    const sessionId = String(input.sessionId || uid('life'))
    if (this.sessionsRepo.get(sessionId)) throw new Error(`session already exists: ${sessionId}`)
    const at = now()
    const session = {
      schema: PPL_PRODUCT_LIFE_SESSION_SCHEMA,
      sessionId,
      userId: input.userId ? String(input.userId) : null,
      createdAt: at,
      updatedAt: at,
      state: clone(this.profile.initialState),
      requests: {},
      processedOps: {},
      audit: [],
      metadata: clone(input.metadata || {}),
    }
    const row = this.sessionsRepo.create(sessionId, session)
    this.#saveWithAudit(row, session, 'session.created', { userId: session.userId })
    return clone(session)
  }

  listSessions() {
    return this.sessionsRepo.list().map(row => ({ sessionId: row.id, userId: row.value.userId, updatedAt: row.value.updatedAt, state: clone(row.value.state) }))
  }
  getSession(sessionId) { return clone(this.#require(sessionId).value) }
  getAudit(sessionId) { return clone(this.#require(sessionId).value.audit) }

  compileTurn(sessionId, input = {}) {
    const row = this.#require(sessionId)
    const session = row.value
    const request = compileLifeHostRequest(this.profile, session.state, input)
    session.requests[request.requestId] = request
    const audit = this.#audit(session, 'request.compiled', { requestId: request.requestId, hostRisk: request.hostRisk, actionKinds: request.responseContract.actionKinds })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: audit.eventId, type: audit.type, payload: audit.data, at: audit.at })
    return clone(request)
  }

  applyResponse(sessionId, input = {}) {
    const row = this.#require(sessionId)
    const session = row.value
    const requestId = String(input.requestId || '')
    const request = session.requests[requestId]
    if (!request) throw new Error(`request not found: ${requestId}`)
    const check = validateLifeHostResponse(request, input.response)
    if (!check.valid) throw new Error(`Invalid Life host response: ${check.errors.join('; ')}`)
    const opKey = `response:${requestId}`
    const opFp = fingerprint(input.response)
    if (session.processedOps[opKey]) {
      if (session.processedOps[opKey] !== opFp) return this.#idempotencyConflict(opKey)
      return { duplicate: true, state: clone(session.state), response: clone(input.response) }
    }
    const applied = applyLifeModelResponse(this.profile, session.state, request, input.response)
    session.state = clone(applied.state)
    session.processedOps[opKey] = opFp
    const audit = this.#audit(session, applied.finalized?.committed ? 'response.committed' : 'response.no-state-mutation', { requestId, actionKind: input.response.action.kind })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: audit.eventId, type: audit.type, payload: audit.data, at: audit.at })
    return { duplicate: false, state: clone(session.state), response: clone(input.response), finalized: clone(applied.finalized) }
  }

  setPreference(sessionId, input = {}) {
    const key = String(input.key || '')
    if (!['quietPlaces', 'morningPlanning'].includes(key)) throw new Error(`unsupported preference key: ${key}`)
    if (typeof input.value !== 'boolean') throw new Error('preference value must be boolean')
    const requestId = String(input.requestId || input.eventId || uid('life-pref'))
    const row = this.#require(sessionId)
    const session = row.value
    const op = { kind: 'set-preference', key, value: input.value }
    const duplicate = this.#checkOp(session, requestId, op)
    if (duplicate) return { duplicate: true, state: clone(session.state) }
    const request = compileLifeHostRequest(this.profile, session.state, {
      requestId,
      userMessage: input.userMessage || `Set preference ${key}=${input.value}`,
      mutationAuthorization: { preference: true },
      requiredActionKind: 'life-preference-proposal',
      requiredPreference: { key, value: input.value },
    })
    const response = buildLifeHostOwnedMutationFallback(request)
    const applied = applyLifeModelResponse(this.profile, session.state, request, response)
    session.state = clone(applied.state)
    session.processedOps[requestId] = fingerprint(op)
    const audit = this.#audit(session, 'preference.committed', { requestId, key, value: input.value })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: audit.eventId, type: audit.type, payload: audit.data, at: audit.at })
    return { duplicate: false, message: response.message, state: clone(session.state) }
  }

  setPlan(sessionId, input = {}) {
    const plan = String(input.plan || '').trim()
    if (!plan) throw new Error('plan required')
    const requestId = String(input.requestId || input.eventId || uid('life-plan'))
    const row = this.#require(sessionId)
    const session = row.value
    const op = { kind: 'set-plan', plan }
    const duplicate = this.#checkOp(session, requestId, op)
    if (duplicate) return { duplicate: true, state: clone(session.state) }
    const request = compileLifeHostRequest(this.profile, session.state, {
      requestId,
      userMessage: input.userMessage || `Set plan: ${plan}`,
      mutationAuthorization: { plan: true },
      requiredActionKind: 'life-plan-proposal',
      requiredPlan: plan,
    })
    const response = buildLifeHostOwnedMutationFallback(request)
    const applied = applyLifeModelResponse(this.profile, session.state, request, response)
    session.state = clone(applied.state)
    session.processedOps[requestId] = fingerprint(op)
    const audit = this.#audit(session, 'plan.committed', { requestId, plan })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: audit.eventId, type: audit.type, payload: audit.data, at: audit.at })
    return { duplicate: false, message: response.message, state: clone(session.state) }
  }

  observeRealtime(sessionId, input = {}) {
    if (!input.locator) throw new Error('locator required')
    const opId = String(input.eventId || uid('life-fact'))
    const row = this.#require(sessionId)
    const session = row.value
    const op = { kind: 'realtime-observation', locator: String(input.locator) }
    if (this.#checkOp(session, opId, op)) return { duplicate: true, state: clone(session.state) }
    const applied = observeLifeRealtimeFact(this.profile, session.state, { id: opId, locator: input.locator, host: { turn: 1, step: 1 } })
    session.state = clone(applied.state)
    session.processedOps[opId] = fingerprint(op)
    const audit = this.#audit(session, 'realtime.observed-not-persisted', { eventId: opId, locator: String(input.locator) })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: audit.eventId, type: audit.type, payload: audit.data, at: audit.at })
    return { duplicate: false, state: clone(session.state), durableFactStored: session.state.service.lastRealtimeFactStored }
  }

  escalateHighRisk(sessionId, input = {}) {
    const opId = String(input.eventId || uid('life-risk'))
    const row = this.#require(sessionId)
    const session = row.value
    const op = { kind: 'high-risk', reason: String(input.reason || '') }
    if (this.#checkOp(session, opId, op)) return { duplicate: true, state: clone(session.state) }
    const applied = applyLifeHostRisk(this.profile, session.state, { id: opId, reason: input.reason, host: { turn: 1, step: 1 } })
    session.state = clone(applied.state)
    session.processedOps[opId] = fingerprint(op)
    const request = compileLifeHostRequest(this.profile, session.state, { requestId: `request:${opId}`, userMessage: input.userMessage || '', hostRisk: { level: 'high', reason: input.reason || '', authoritativeLayer: input.authoritativeLayer || null } })
    const audit = this.#audit(session, 'risk.escalated', { eventId: opId, reason: String(input.reason || ''), authoritativeLayer: input.authoritativeLayer || null })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: audit.eventId, type: audit.type, payload: audit.data, at: audit.at })
    return { duplicate: false, state: clone(session.state), requiredMessage: request.responseContract.requiredMessage, allowedActions: request.responseContract.actionKinds }
  }

  #checkOp(session, opId, payload) {
    const current = session.processedOps[opId]
    if (!current) return false
    if (current !== fingerprint(payload)) this.#idempotencyConflict(opId)
    return true
  }
  #idempotencyConflict(key) {
    const error = new Error(`operation id reused with different payload: ${key}`)
    error.code = 'IDEMPOTENCY_CONFLICT'
    throw error
  }
  #require(sessionId) {
    const row = this.sessionsRepo.get(String(sessionId))
    if (!row) throw new Error(`unknown session: ${sessionId}`)
    return row
  }
  #audit(session, type, data) {
    const event = { eventId: uid('audit'), at: now(), type, data: clone(data) }
    session.audit.push(event); session.updatedAt = event.at; return event
  }
  #saveWithAudit(row, session, type, data) {
    const event = this.#audit(session, type, data)
    this.sessionsRepo.save(session.sessionId, session, row.revision)
    this.auditRepo.append(session.sessionId, { eventId: event.eventId, type: event.type, payload: event.data, at: event.at })
  }
  close() { this.store?.close?.() }
}
