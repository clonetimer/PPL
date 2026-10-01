import test from 'node:test'
import assert from 'node:assert/strict'
import { ResearchGovernanceService } from '../src/research-governance.mjs'

function seededService() {
  const service = new ResearchGovernanceService()
  const session = service.createSession({ sessionId: 's1', question: 'Is A better than B?' })
  service.addClaim(session.sessionId, {
    claimId: 'support', canonicalText: 'Source A supports A on metric M.', status: 'supported', polarity: 'support', confidence: 0.8,
    sourceRefs: ['source:a'], assertedBy: 'researcher', requiredForDecision: true, conflictSetId: 'effect',
  })
  service.addClaim(session.sessionId, {
    claimId: 'oppose', canonicalText: 'Source B does not support A on metric M.', status: 'supported', polarity: 'oppose', confidence: 0.75,
    sourceRefs: ['source:b'], assertedBy: 'researcher', requiredForDecision: true, conflictSetId: 'effect',
  })
  return { service, sessionId: session.sessionId }
}

test('product service creates a research session and evidence ledger', () => {
  const { service, sessionId } = seededService()
  assert.equal(service.getEvidence(sessionId).length, 2)
  assert.equal(service.getSession(sessionId).status, 'evidence-ready')
})

test('handoff cannot silently drop one side of a material conflict', () => {
  const { service, sessionId } = seededService()
  const result = service.createHandoff(sessionId, {
    sourceAgentId: 'researcher', targetAgentId: 'analyst', requestedCapabilities: ['analyze-evidence'],
    requestedAuthorityScopes: ['research:evidence'], allowedClaimIds: ['support'],
    task: { objective: 'analyze' },
  })
  assert.equal(result.allowed, false)
  assert.equal(result.phase, 'projection')
  assert.ok(result.projection.violations.some(row => row.code === 'REQUIRED_CLAIM_NOT_PROJECTABLE' || row.code === 'CONFLICT_SET_PARTIAL_PROJECTION'))
})

test('receiver-side counter-evidence erasure is detected', () => {
  const { service, sessionId } = seededService()
  const result = service.createHandoff(sessionId, {
    sourceAgentId: 'researcher', targetAgentId: 'analyst', requestedCapabilities: ['analyze-evidence'],
    requestedAuthorityScopes: ['research:evidence'], task: { objective: 'analyze' },
  })
  assert.equal(result.allowed, true)
  const report = service.assessHandoff(sessionId, {
    handoffId: result.handoff.handoffId,
    receivedContext: { schema: 'ppl.multi-agent.context/0.1', state: result.handoff.payload.state, claims: result.handoff.payload.claims.filter(row => row.claimId !== 'oppose') },
    receivedTask: result.handoff.task,
  })
  assert.equal(report.hardGatePassed, false)
  assert.ok(report.findings.some(row => row.code === 'COUNTER_EVIDENCE_ERASURE'))
})

test('final delivery is blocked until explicit semantic judge evidence passes', () => {
  const { service, sessionId } = seededService()
  const pending = service.prepareDelivery(sessionId, {
    parentClaimIds: ['support', 'oppose'],
    derivedConclusion: 'Evidence remains mixed.',
  })
  assert.equal(pending.status, 'pending-semantic-judge')
  const blocked = service.finalizeDelivery(sessionId, {
    deliveryId: pending.deliveryId,
    judgeResult: {
      pass: false,
      counterEvidenceIntegrated: true,
      uncertaintyCalibrated: true,
      attributionPreservation: true,
      metricScopePreservation: true,
      conclusionSupported: false,
      noNovelFacts: true,
      findings: ['conclusion is broader than evidence'],
    },
  })
  assert.equal(blocked.status, 'blocked')
  assert.equal(service.getSession(sessionId).status, 'delivery-blocked')
})

test('validated delivery deterministically renders both canonical evidence claims', () => {
  const { service, sessionId } = seededService()
  const pending = service.prepareDelivery(sessionId, {
    parentClaimIds: ['support', 'oppose'],
    derivedConclusion: 'Evidence remains mixed.',
  })
  const delivered = service.finalizeDelivery(sessionId, {
    deliveryId: pending.deliveryId,
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
  assert.equal(delivered.status, 'delivered')
  assert.match(delivered.rendered.renderedText, /Source A supports A on metric M\./)
  assert.match(delivered.rendered.renderedText, /Source B does not support A on metric M\./)
  assert.match(delivered.rendered.renderedText, /Evidence remains mixed\./)
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqliteRecordStore } from '@ppl/platform-core'

test('research session and evidence survive sqlite restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppl-research-'))
  const db = path.join(dir, 'ppl.sqlite')
  let store = new SqliteRecordStore(db)
  let service = new ResearchGovernanceService({ store })
  service.createSession({ sessionId: 'persist-research', question: 'q' })
  service.addClaim('persist-research', { claimId: 'c1', canonicalText: 'Evidence one.', polarity: 'support', requiredForDecision: true, sourceRefs: ['source:1'] })
  store.close()
  store = new SqliteRecordStore(db)
  service = new ResearchGovernanceService({ store })
  assert.equal(service.getSession('persist-research').question, 'q')
  assert.equal(service.getEvidence('persist-research').length, 1)
  store.close()
})
