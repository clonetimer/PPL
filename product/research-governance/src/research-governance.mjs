import crypto from 'node:crypto'
import {
  PPL_MAG_CONTEXT_SCHEMA,
  PPL_MAG_BOUND_DELIVERY_JUDGE_RESULT_SCHEMA,
  compileGovernance,
  validateContext,
  buildGovernedHandoff,
  assessInformationFidelity,
  buildDeliveryEvidenceBinding,
  buildBoundDeliveryFidelityJudgeRequest,
  finalizeBoundDeliveryFidelityAssessment,
  renderGovernedDelivery,
} from '@ppl/multi-agent-governance'
import { MemoryRecordStore, SessionRepository, AuditRepository, EvidenceRepository } from '@ppl/platform-core'

export const PPL_PRODUCT_RESEARCH_SESSION_SCHEMA = 'ppl.product.research-session/1'
export const PPL_PRODUCT_AUDIT_EVENT_SCHEMA = 'ppl.product.audit-event/1'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`
}

function now() {
  return new Date().toISOString()
}

function requireText(value, label) {
  const out = String(value ?? '').trim()
  if (!out) throw new Error(`${label} required`)
  return out
}

function defaultAgentContracts() {
  const commonContext = {
    allowedSensitivities: ['public', 'task'],
    allowedStatePaths: ['sessionId', 'question'],
    preserveConflictSets: true,
  }
  return [
    {
      schema: 'ppl.multi-agent.agent-contract/0.1',
      agentId: 'researcher',
      role: 'evidence-researcher',
      authorityScopes: ['research:evidence'],
      capabilities: ['collect-evidence', 'handoff-evidence'],
      tools: ['search', 'fetch-source'],
      delegation: {
        allowedTargets: ['analyst'],
        maxDepth: 2,
        transferableAuthorityScopes: ['research:evidence'],
        allowCycles: false,
        allowSelfDelegation: false
      },
      contextPolicy: commonContext,
    },
    {
      schema: 'ppl.multi-agent.agent-contract/0.1',
      agentId: 'analyst',
      role: 'evidence-analyst',
      authorityScopes: ['research:evidence', 'research:analysis'],
      capabilities: ['analyze-evidence', 'handoff-analysis'],
      tools: [],
      delegation: {
        allowedTargets: ['reviewer'],
        maxDepth: 3,
        transferableAuthorityScopes: ['research:evidence', 'research:analysis'],
        allowCycles: false,
        allowSelfDelegation: false
      },
      contextPolicy: commonContext,
    },
    {
      schema: 'ppl.multi-agent.agent-contract/0.1',
      agentId: 'reviewer',
      role: 'evidence-reviewer',
      authorityScopes: ['research:evidence', 'research:analysis', 'research:delivery'],
      capabilities: ['review-evidence', 'prepare-delivery'],
      tools: [],
      delegation: {
        allowedTargets: ['delivery'],
        maxDepth: 4,
        transferableAuthorityScopes: ['research:evidence', 'research:delivery'],
        allowCycles: false,
        allowSelfDelegation: false
      },
      contextPolicy: commonContext,
    },
    {
      schema: 'ppl.multi-agent.agent-contract/0.1',
      agentId: 'delivery',
      role: 'user-delivery-boundary',
      authorityScopes: ['research:evidence', 'research:delivery'],
      capabilities: ['render-delivery'],
      tools: [],
      delegation: {
        allowedTargets: [],
        maxDepth: 4,
        transferableAuthorityScopes: [],
        allowCycles: false,
        allowSelfDelegation: false
      },
      contextPolicy: commonContext,
    },
  ]
}

export function createDefaultResearchGovernance() {
  return compileGovernance(defaultAgentContracts())
}

export class ResearchGovernanceService {
  constructor(options = {}) {
    this.governance = options.governance || createDefaultResearchGovernance()
    this.store = options.store || new MemoryRecordStore()
    this.sessionRepository = options.sessionRepository || new SessionRepository(this.store, 'research')
    this.auditRepository = options.auditRepository || new AuditRepository(this.store, 'research')
    this.evidenceRepository = options.evidenceRepository || new EvidenceRepository(this.store, 'research')
  }

  createSession(input = {}) {
    const question = requireText(input.question, 'question')
    const sessionId = input.sessionId || id('research')
    if (this.sessionRepository.get(sessionId)) throw new Error(`session already exists: ${sessionId}`)
    const createdAt = now()
    const session = {
      schema: PPL_PRODUCT_RESEARCH_SESSION_SCHEMA,
      sessionId,
      question,
      status: 'collecting',
      createdAt,
      updatedAt: createdAt,
      context: {
        schema: PPL_MAG_CONTEXT_SCHEMA,
        state: { sessionId, question },
        claims: [],
      },
      handoffs: [],
      fidelity: [],
      deliveries: [],
      audit: [],
      metadata: clone(input.metadata || {}),
    }
    const created = this.sessionRepository.create(sessionId, session)
    this.#audit(session, 'session.created', { question })
    this.#persist(session, created.revision)
    return clone(session)
  }

  listSessions() {
    return this.sessionRepository.list().map(row => {
      const session = row.value
      return {
        sessionId: session.sessionId,
        question: session.question,
        status: session.status,
        claims: session.context.claims.length,
        handoffs: session.handoffs.length,
        deliveries: session.deliveries.length,
        updatedAt: session.updatedAt,
      }
    })
  }

  getSession(sessionId) {
    return clone(this.#requireRow(sessionId).value)
  }

  addClaim(sessionId, input = {}) {
    const row = this.#requireRow(sessionId)
    const session = row.value
    const claimId = input.claimId || id('claim')
    if (session.context.claims.some(claim => claim.claimId === claimId)) throw new Error(`duplicate claimId: ${claimId}`)
    const claim = {
      claimId,
      canonicalText: requireText(input.canonicalText, 'canonicalText'),
      status: input.status || 'supported',
      polarity: input.polarity || 'neutral',
      confidence: Number(input.confidence ?? 0.5),
      sourceRefs: [...new Set((input.sourceRefs || []).map(String).filter(Boolean))],
      assertedBy: input.assertedBy || 'researcher',
      sensitivity: input.sensitivity || 'task',
      requiredForDecision: input.requiredForDecision === true,
      conflictSetId: input.conflictSetId || null,
      derivedFrom: [...new Set((input.derivedFrom || []).map(String).filter(Boolean))],
      authorityScope: input.authorityScope || 'research:evidence',
    }
    const candidateContext = clone(session.context)
    candidateContext.claims.push(claim)
    const check = validateContext(candidateContext)
    if (!check.valid) throw new Error(`invalid claim/context: ${check.errors.join('; ')}`)
    session.context = candidateContext
    session.status = 'evidence-ready'
    this.evidenceRepository.put(`${sessionId}:${claimId}`, { sessionId, ...clone(claim) })
    this.#audit(session, 'claim.recorded', { claimId, polarity: claim.polarity, conflictSetId: claim.conflictSetId })
    this.#persist(session, row.revision)
    return clone(claim)
  }

  createHandoff(sessionId, input = {}) {
    const row = this.#requireRow(sessionId)
    const session = row.value
    const sourceAgentId = requireText(input.sourceAgentId, 'sourceAgentId')
    const targetAgentId = requireText(input.targetAgentId, 'targetAgentId')
    const taskId = input.taskId || id('task')
    const task = input.task || { objective: session.question }
    const result = buildGovernedHandoff(this.governance, {
      delegation: {
        sourceAgentId,
        targetAgentId,
        taskId,
        chain: input.chain || [sourceAgentId],
        depth: Number.isInteger(input.depth) ? input.depth : (input.chain || [sourceAgentId]).length,
        requestedCapabilities: input.requestedCapabilities || [],
        requestedTools: input.requestedTools || [],
        requestedAuthorityScopes: input.requestedAuthorityScopes || ['research:evidence'],
      },
      context: session.context,
      requiredClaimIds: input.requiredClaimIds || session.context.claims.filter(claim => claim.requiredForDecision).map(claim => claim.claimId),
      allowedClaimIds: input.allowedClaimIds || [],
      denyClaimIds: input.denyClaimIds || [],
      task,
      transform: input.transform || { mode: 'verbatim' },
    })
    this.#audit(session, result.allowed ? 'handoff.created' : 'handoff.blocked', {
      sourceAgentId,
      targetAgentId,
      taskId,
      phase: result.phase,
      violations: result.delegationDecision?.violations || result.projection?.violations || [],
    })
    if (result.allowed) session.handoffs.push(clone(result.handoff))
    this.#persist(session, row.revision)
    return clone(result)
  }

  assessHandoff(sessionId, input = {}) {
    const row = this.#requireRow(sessionId)
    const session = row.value
    const handoff = this.#findHandoff(session, requireText(input.handoffId, 'handoffId'))
    const report = assessInformationFidelity({
      handoff,
      receivedContext: input.receivedContext,
      receivedTask: input.receivedTask,
      confidenceTolerance: input.confidenceTolerance,
    })
    session.fidelity.push(clone(report))
    this.#audit(session, report.hardGatePassed ? 'fidelity.checked' : 'fidelity.blocked', {
      handoffId: handoff.handoffId,
      hardGatePassed: report.hardGatePassed,
      findings: report.findings,
    })
    this.#persist(session, row.revision)
    return clone(report)
  }

  prepareDelivery(sessionId, input = {}) {
    let row = this.#requireRow(sessionId)
    let session = row.value
    const parentClaimIds = [...new Set((input.parentClaimIds || session.context.claims.filter(claim => claim.requiredForDecision).map(claim => claim.claimId)).map(String))]
    const derivedConclusion = requireText(input.derivedConclusion, 'derivedConclusion')
    const handoffResult = this.createHandoff(sessionId, {
      sourceAgentId: input.sourceAgentId || 'reviewer',
      targetAgentId: input.targetAgentId || 'delivery',
      taskId: input.taskId || id('delivery-task'),
      chain: input.chain || ['researcher', 'analyst', 'reviewer'],
      depth: input.depth ?? 3,
      requestedCapabilities: ['render-delivery'],
      requestedTools: [],
      requestedAuthorityScopes: ['research:evidence', 'research:delivery'],
      requiredClaimIds: parentClaimIds,
      task: input.task || { objective: session.question, output: 'user-visible-research-answer' },
      transform: { mode: 'delivery-synthesis', summary: derivedConclusion },
    })
    if (!handoffResult.allowed) return handoffResult
    row = this.#requireRow(sessionId)
    session = row.value

    const handoff = handoffResult.handoff
    const binding = buildDeliveryEvidenceBinding({ handoff, parentClaimIds, derivedConclusion })
    const structuralReport = assessInformationFidelity({
      handoff,
      receivedContext: { schema: PPL_MAG_CONTEXT_SCHEMA, state: clone(handoff.payload.state), claims: clone(handoff.payload.claims) },
      receivedTask: clone(handoff.task),
    })
    const judgeRequest = buildBoundDeliveryFidelityJudgeRequest({ handoff, binding })
    const delivery = {
      deliveryId: id('delivery-candidate'),
      status: 'pending-semantic-judge',
      handoffId: handoff.handoffId,
      binding,
      structuralReport,
      judgeRequest,
      createdAt: now(),
    }
    session.deliveries.push(delivery)
    session.status = 'delivery-pending'
    this.#audit(session, 'delivery.prepared', { deliveryId: delivery.deliveryId, handoffId: handoff.handoffId, parentClaimIds })
    this.#persist(session, row.revision)
    return clone(delivery)
  }

  finalizeDelivery(sessionId, input = {}) {
    const row = this.#requireRow(sessionId)
    const session = row.value
    const deliveryId = requireText(input.deliveryId, 'deliveryId')
    const delivery = session.deliveries.find(row => row.deliveryId === deliveryId)
    if (!delivery) throw new Error(`unknown deliveryId: ${deliveryId}`)
    if (delivery.status !== 'pending-semantic-judge') throw new Error(`delivery not pending: ${delivery.status}`)
    const handoff = this.#findHandoff(session, delivery.handoffId)
    const judgeResult = clone(input.judgeResult)
    if (!judgeResult || typeof judgeResult !== 'object') throw new Error('judgeResult required')
    judgeResult.schema ||= PPL_MAG_BOUND_DELIVERY_JUDGE_RESULT_SCHEMA
    judgeResult.handoffId ||= delivery.handoffId
    judgeResult.bindingId ||= delivery.binding.bindingId

    const assessment = finalizeBoundDeliveryFidelityAssessment(delivery.structuralReport, delivery.binding, judgeResult)
    delivery.judgeResult = judgeResult
    delivery.assessment = assessment
    if (!assessment.passed) {
      delivery.status = 'blocked'
      session.status = 'delivery-blocked'
      this.#audit(session, 'delivery.blocked', { deliveryId, findings: assessment.findings })
      this.#persist(session, row.revision)
      return clone(delivery)
    }
    const rendered = renderGovernedDelivery({ handoff, binding: delivery.binding })
    delivery.status = 'delivered'
    delivery.rendered = rendered
    delivery.deliveredAt = now()
    session.status = 'delivered'
    this.#audit(session, 'delivery.delivered', { deliveryId, evidenceCount: rendered.evidenceCount })
    this.#persist(session, row.revision)
    return clone(delivery)
  }

  getEvidence(sessionId) {
    const session = this.#requireRow(sessionId).value
    return clone(session.context.claims)
  }

  getAudit(sessionId) {
    return clone(this.#requireRow(sessionId).value.audit)
  }

  #findHandoff(session, handoffId) {
    const handoff = session.handoffs.find(row => row.handoffId === handoffId)
    if (!handoff) throw new Error(`unknown handoffId: ${handoffId}`)
    return handoff
  }

  #requireRow(sessionId) {
    const row = this.sessionRepository.get(String(sessionId))
    if (!row) throw new Error(`unknown session: ${sessionId}`)
    return row
  }

  #audit(session, type, data = {}) {
    const event = {
      schema: PPL_PRODUCT_AUDIT_EVENT_SCHEMA,
      eventId: id('audit'),
      at: now(),
      type,
      data: clone(data),
    }
    session.audit.push(event)
    session.updatedAt = event.at
    this.auditRepository.append(session.sessionId, { eventId: event.eventId, type: event.type, payload: event.data, at: event.at })
    return event
  }

  #persist(session, revision) {
    return this.sessionRepository.save(session.sessionId, session, revision)
  }

  close() { this.store?.close?.() }
}
