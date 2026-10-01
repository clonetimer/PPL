#!/usr/bin/env node
import { ResearchGovernanceService } from '../src/research-governance.mjs'

const service = new ResearchGovernanceService()
const session = service.createSession({
  sessionId: 'demo-conflicting-evidence',
  question: 'Does method A clearly outperform method B?',
})

const support = service.addClaim(session.sessionId, {
  claimId: 'claim-support',
  canonicalText: 'Study A reports lower mean error for method A on dataset X.',
  status: 'supported',
  polarity: 'support',
  confidence: 0.82,
  sourceRefs: ['doi:10.example/a'],
  assertedBy: 'researcher',
  requiredForDecision: true,
  conflictSetId: 'method-a-effect',
})
const oppose = service.addClaim(session.sessionId, {
  claimId: 'claim-oppose',
  canonicalText: 'Study B reports no statistically significant advantage for method A on dataset Y.',
  status: 'supported',
  polarity: 'oppose',
  confidence: 0.78,
  sourceRefs: ['doi:10.example/b'],
  assertedBy: 'researcher',
  requiredForDecision: true,
  conflictSetId: 'method-a-effect',
})

const handoff = service.createHandoff(session.sessionId, {
  sourceAgentId: 'researcher',
  targetAgentId: 'analyst',
  requestedCapabilities: ['analyze-evidence'],
  requestedAuthorityScopes: ['research:evidence'],
  requiredClaimIds: [support.claimId, oppose.claimId],
  task: { objective: 'Analyze whether the evidence supports a clear advantage.' },
})

const distortedContext = {
  schema: handoff.handoff.payload ? 'ppl.multi-agent.context/0.1' : '',
  state: handoff.handoff.payload.state,
  claims: handoff.handoff.payload.claims.filter(claim => claim.claimId !== oppose.claimId),
}
const blocked = service.assessHandoff(session.sessionId, {
  handoffId: handoff.handoff.handoffId,
  receivedContext: distortedContext,
  receivedTask: handoff.handoff.task,
})

const cleanContext = {
  schema: 'ppl.multi-agent.context/0.1',
  state: handoff.handoff.payload.state,
  claims: handoff.handoff.payload.claims,
}
const clean = service.assessHandoff(session.sessionId, {
  handoffId: handoff.handoff.handoffId,
  receivedContext: cleanContext,
  receivedTask: handoff.handoff.task,
})

const delivery = service.prepareDelivery(session.sessionId, {
  parentClaimIds: [support.claimId, oppose.claimId],
  derivedConclusion: 'The current evidence is mixed; it does not support a general claim that method A clearly outperforms method B.',
})
const finalized = service.finalizeDelivery(session.sessionId, {
  deliveryId: delivery.deliveryId,
  judgeResult: {
    pass: true,
    counterEvidenceIntegrated: true,
    uncertaintyCalibrated: true,
    attributionPreservation: true,
    metricScopePreservation: true,
    conclusionSupported: true,
    noNovelFacts: true,
    findings: [],
  },
})

console.log(JSON.stringify({
  sessionId: session.sessionId,
  distortionDetected: !blocked.hardGatePassed,
  distortionFindings: blocked.findings.map(row => row.code),
  cleanHandoffPassed: clean.hardGatePassed,
  finalStatus: finalized.status,
  rendered: finalized.rendered?.renderedText,
  auditEvents: service.getAudit(session.sessionId).map(row => row.type),
}, null, 2))
