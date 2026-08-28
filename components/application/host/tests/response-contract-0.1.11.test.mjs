import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { compileGptHostRequest, compileRetryRequest, validateJsonSchemaContract } from '../src/index.mjs'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(fs.readFileSync(new URL('../profiles/research.profile.json', import.meta.url)))

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

test('0.1.11 Tutor final-answer retry is restricted to Host-owned safe copy and fixed rationale', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), { turn: 1, userMessage: '这个比较思路哪里不可靠？不要直接告诉答案。' })
  const retry = compileRetryRequest(req, { status: 'blocked', reason: 'policy-violation', violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', evidenceQuote: '3/4 < 3/2' }] })
  const msg = retry.responseContract.jsonSchema.properties.message
  const rationale = retry.responseContract.jsonSchema.properties.action.properties.rationale
  assert.equal(msg.enum.length, 1)
  assert.match(msg.enum[0], /当前解法|中间步骤|检查问题|关键中间步骤/)
  assert.equal(msg.enum[0].includes('3/4'), false)
  assert.deepEqual(rationale.enum, ['host-policy-safe-retry'])
  assert.equal(retry.instructions.some(x => x.includes('Host-restricted')), true)
})

test('0.1.11 Research conflict retry is restricted to natural Host-owned disclosure copy without policy meta language', () => {
  const req = compileGptHostRequest(research, researchReadyState(), { turn: 1, userMessage: '给出阶段性研究报告。', actionKinds: ['report'] })
  const retry = compileRetryRequest(req, { status: 'blocked', reason: 'policy-violation', violations: [{ code: 'RESEARCH_CONFLICT_ERASURE', evidenceQuote: '方法 A 更稳定。' }] })
  const msg = retry.responseContract.jsonSchema.properties.message
  const rationale = retry.responseContract.jsonSchema.properties.action.properties.rationale
  assert.equal(msg.enum.length, 1)
  assert.equal(msg.enum[0].includes('Experiment B reports no stability advantage and higher tail variance for method A.'), true)
  assert.equal(msg.enum[0].includes('RESEARCH_CONFLICT_ERASURE'), false)
  assert.equal(msg.enum[0].includes('Host'), false)
  assert.deepEqual(rationale.enum, ['host-policy-mandatory-disclosure'])
})

test('0.1.11 Host-side schema validation rejects retry text outside the Host-owned enum', () => {
  const req = compileGptHostRequest(research, researchReadyState(), { turn: 1, userMessage: '给出阶段性研究报告。', actionKinds: ['report'] })
  const retry = compileRetryRequest(req, { status: 'blocked', reason: 'policy-violation', violations: [{ code: 'RESEARCH_CONFLICT_ERASURE', evidenceQuote: '方法 A 更稳定。' }] })
  const schema = retry.responseContract.jsonSchema.properties.message
  const invalid = validateJsonSchemaContract('收到 Host 拒绝，已按 RESEARCH_CONFLICT_ERASURE 执行重试。', schema)
  assert.equal(invalid.valid, false)
})
