import crypto from 'node:crypto'
import {
  PPL_MAG_CONTEXT_SCHEMA,
  compileGovernance,
  validateContext,
  buildGovernedHandoff,
  assessInformationFidelity,
} from '@ppl/multi-agent-governance'
import { MemoryRecordStore, SessionRepository, AuditRepository } from '@ppl/platform-core'

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const now = () => new Date().toISOString()
const uid = prefix => `${prefix}_${crypto.randomUUID()}`
export const PPL_PRODUCT_AGENT_SESSION_SCHEMA = 'ppl.product.agent-governance-session/1'

export class AgentGovernanceService {
  constructor(options = {}) {
    this.store = options.store || new MemoryRecordStore()
    this.sessionsRepo = options.sessionsRepo || new SessionRepository(this.store, 'agent')
    this.auditRepo = options.auditRepo || new AuditRepository(this.store, 'agent')
  }

  createSession(input = {}) {
    const sessionId = String(input.sessionId || uid('agent'))
    if (this.sessionsRepo.get(sessionId)) throw new Error(`session already exists: ${sessionId}`)
    if (!Array.isArray(input.agentContracts) || input.agentContracts.length < 2) throw new Error('agentContracts must contain at least two contracts')
    compileGovernance(input.agentContracts)
    const context = clone(input.context || { schema: PPL_MAG_CONTEXT_SCHEMA, state: {}, claims: [] })
    context.schema ||= PPL_MAG_CONTEXT_SCHEMA
    context.state ||= {}
    context.claims ||= []
    const check = validateContext(context)
    if (!check.valid) throw new Error(`invalid context: ${check.errors.join('; ')}`)
    const at = now()
    const session = {
      schema: PPL_PRODUCT_AGENT_SESSION_SCHEMA,
      sessionId,
      createdAt: at,
      updatedAt: at,
      status: 'active',
      agentContracts: clone(input.agentContracts),
      context,
      handoffs: [],
      fidelity: [],
      audit: [],
      metadata: clone(input.metadata || {}),
    }
    const row = this.sessionsRepo.create(sessionId, session)
    const event = this.#audit(session, 'session.created', { agents: input.agentContracts.map(x => x.agentId) })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: event.eventId, type: event.type, payload: event.data, at: event.at })
    return clone(session)
  }

  listSessions() { return this.sessionsRepo.list().map(row => ({ sessionId: row.id, title: row.value.metadata?.title || row.value.context?.state?.topic || row.value.agentContracts.map(x => x.agentId).join(' → '), status: row.value.status, agents: row.value.agentContracts.map(x => x.agentId), handoffs: row.value.handoffs.length, updatedAt: row.value.updatedAt })) }
  getSession(sessionId) { return clone(this.#require(sessionId).value) }
  getAudit(sessionId) { return clone(this.#require(sessionId).value.audit) }

  replaceContext(sessionId, input = {}) {
    const row = this.#require(sessionId); const session = row.value
    const context = clone(input.context)
    const check = validateContext(context)
    if (!check.valid) throw new Error(`invalid context: ${check.errors.join('; ')}`)
    session.context = context
    const event = this.#audit(session, 'context.replaced-by-host', { claimCount: context.claims?.length || 0 })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: event.eventId, type: event.type, payload: event.data, at: event.at })
    return clone(context)
  }

  createHandoff(sessionId, input = {}) {
    const row = this.#require(sessionId); const session = row.value
    const sourceAgentId = String(input.sourceAgentId || '').trim(); const targetAgentId = String(input.targetAgentId || '').trim()
    if (!sourceAgentId || !targetAgentId) throw new Error('sourceAgentId and targetAgentId required')
    const governance = compileGovernance(session.agentContracts)
    const chain = input.chain || [sourceAgentId]
    const result = buildGovernedHandoff(governance, {
      delegation: {
        sourceAgentId, targetAgentId,
        taskId: input.taskId || uid('task'),
        chain,
        depth: Number.isInteger(input.depth) ? input.depth : chain.length,
        requestedCapabilities: input.requestedCapabilities || [],
        requestedTools: input.requestedTools || [],
        requestedAuthorityScopes: input.requestedAuthorityScopes || [],
      },
      context: session.context,
      requiredClaimIds: input.requiredClaimIds || session.context.claims.filter(x => x.requiredForDecision).map(x => x.claimId),
      allowedClaimIds: input.allowedClaimIds || [],
      denyClaimIds: input.denyClaimIds || [],
      task: input.task || {},
      transform: input.transform || { mode: 'verbatim' },
    })
    if (result.allowed) session.handoffs.push(clone(result.handoff))
    else session.status = 'handoff-blocked'
    const event = this.#audit(session, result.allowed ? 'handoff.created' : 'handoff.blocked', { sourceAgentId, targetAgentId, phase: result.phase, violations: result.delegationDecision?.violations || result.projection?.violations || [] })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: event.eventId, type: event.type, payload: event.data, at: event.at })
    return clone(result)
  }

  assessHandoff(sessionId, input = {}) {
    const row = this.#require(sessionId); const session = row.value
    const handoff = session.handoffs.find(x => x.handoffId === input.handoffId)
    if (!handoff) throw new Error(`unknown handoffId: ${input.handoffId}`)
    const report = assessInformationFidelity({ handoff, receivedContext: input.receivedContext, receivedTask: input.receivedTask, confidenceTolerance: input.confidenceTolerance })
    session.fidelity.push(clone(report))
    if (!report.hardGatePassed) session.status = 'fidelity-blocked'
    const event = this.#audit(session, report.hardGatePassed ? 'fidelity.passed' : 'fidelity.blocked', { handoffId: handoff.handoffId, findings: report.findings })
    this.sessionsRepo.save(sessionId, session, row.revision)
    this.auditRepo.append(sessionId, { eventId: event.eventId, type: event.type, payload: event.data, at: event.at })
    return clone(report)
  }

  #require(sessionId) { const row = this.sessionsRepo.get(String(sessionId)); if (!row) throw new Error(`unknown session: ${sessionId}`); return row }
  #audit(session, type, data) { const event = { eventId: uid('audit'), at: now(), type, data: clone(data) }; session.audit.push(event); session.updatedAt = event.at; return event }
  close() { this.store?.close?.() }
}
