import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  compileGptHostRequest,
  compileAgentPolicyJudgeRequest,
  compileRetryRequest,
} from '../src/index.mjs'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(fs.readFileSync(new URL('../profiles/research.profile.json', import.meta.url)))

function tutorState() {
  const s = structuredClone(tutor.initialState)
  return s
}

function researchReadyState() {
  const s = structuredClone(research.initialState)
  s.research.question = 'Q'
  s.research.activeClaimId = 'c1'
  s.research.claimOrder = ['c1']
  s.research.claims = { c1: {
    id: 'c1', text: 'A is more stable than B', kind: 'hypothesis', status: 'ready',
    supportMass: 2.6, opposeMass: 0.8, neutralMass: 0, uncertainty: 0.2, evidenceCount: 2,
    independentSourceCount: 2, sourceGroups: ['a','b'], supportGroups: ['a'], opposeGroups: ['b'], provenanceComplete: true,
    validation: { attempts: 1, supportive: 1, opposing: 0, inconclusive: 0, reproducibleSupport: 1, reproducibleOppose: 0, strongSupport: 1, strongOppose: 0, last: null },
    decision: { status: 'ready', direction: 'support', reasons: [], counterRatio: 0.3, conflict: { present: true, supportMass: 2.6, opposeMass: 0.8, balanceRatio: 0.3, dominantStance: 'support' } },
    conflict: { present: true, supportMass: 2.6, opposeMass: 0.8, balanceRatio: 0.3, dominantStance: 'support' },
  } }
  s.research.evidenceLedger = [
    { evidenceId: 'e1', claimId: 'c1', stance: 'support', summary: 'Experiment A supports method A.', source: { locator: 'app://a' }, quality: { group: 'a' }, provenanceComplete: true },
    { evidenceId: 'e2', claimId: 'c1', stance: 'oppose', summary: 'Experiment B reports no stability advantage and higher tail variance for method A.', source: { locator: 'app://b' }, quality: { group: 'b' }, provenanceComplete: true },
  ]
  s.research.evidenceIds = ['e1','e2']
  s.research.validationLedger = []
  s.research.conclusionStatus = 'ready'
  s.research.conclusionDirection = 'support'
  s.workflow = { nextAction: 'report' }
  return s
}

test('0.1.10 Tutor retry bounds message and action rationale', () => {
  const req = compileGptHostRequest(tutor, tutorState(), { turn: 1, userMessage: 'help' })
  const retry = compileRetryRequest(req, { status: 'blocked', reason: 'policy-violation', violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', evidenceQuote: '3/4 < 3/2' }] })
  assert.equal(retry.responseContract.jsonSchema.properties.message.maxLength, 480)
  assert.equal(retry.responseContract.jsonSchema.properties.action.properties.rationale.maxLength, 160)
  assert.equal(retry.instructions.some(x => x.includes('action.rationale <= 160')), true)
})

test('0.1.10 Research report without verbatim opposing evidence gets deterministic conflict-erasure violation', () => {
  const req = compileGptHostRequest(research, researchReadyState(), { turn: 1, userMessage: 'report', actionKinds: ['report'] })
  const response = { schema: 'ppl.gpt-host-response/0.1', message: '阶段性报告：方法 A 更稳定。', action: { kind: 'report', conclusionStatus: 'ready', conclusionDirection: 'support', rationale: 'support', claim: null, plan: null }, citations: [] }
  const judge = compileAgentPolicyJudgeRequest(req, response, {})
  assert.equal(judge.deterministicViolations.some(v => v.code === 'RESEARCH_CONFLICT_ERASURE'), true)
})

test('0.1.10 Research report with Host opposing summary is not deterministically flagged for erasure', () => {
  const req = compileGptHostRequest(research, researchReadyState(), { turn: 1, userMessage: 'report', actionKinds: ['report'] })
  const response = { schema: 'ppl.gpt-host-response/0.1', message: '阶段性报告：方法 A 当前获得更多支持。Experiment B reports no stability advantage and higher tail variance for method A.', action: { kind: 'report', conclusionStatus: 'ready', conclusionDirection: 'support', rationale: 'qualified', claim: null, plan: null }, citations: [] }
  const judge = compileAgentPolicyJudgeRequest(req, response, {})
  assert.equal(judge.deterministicViolations.some(v => v.code === 'RESEARCH_CONFLICT_ERASURE'), false)
})

test('0.1.10 Research conflict-erasure retry requires verbatim Host opposing disclosure', () => {
  const req = compileGptHostRequest(research, researchReadyState(), { turn: 1, userMessage: 'report', actionKinds: ['report'] })
  const retry = compileRetryRequest(req, { status: 'blocked', reason: 'policy-violation', violations: [{ code: 'RESEARCH_CONFLICT_ERASURE', evidenceQuote: '方法 A 更稳定。' }] })
  assert.equal(retry.instructions.some(x => x.includes('VERBATIM') && x.includes('Experiment B reports no stability advantage')), true)
  assert.equal(retry.responseContract.jsonSchema.properties.action.properties.rationale.maxLength <= 320, true)
})
