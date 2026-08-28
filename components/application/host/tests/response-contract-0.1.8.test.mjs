import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  compileGptHostRequest,
  compileAgentPolicyJudgeRequest,
  compileRetryRequest,
  applyResearchHostEvent,
  applyResearchModelResponse,
} from '../src/index.mjs'

const tutor = JSON.parse(await readFile(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(await readFile(new URL('../profiles/research.profile.json', import.meta.url)))

function researchWithClaim() {
  let state = applyResearchHostEvent(research, research.initialState, { type: 'QUESTION_DEFINED', payload: { question: 'Q' } }, { turn: 1 }).state
  const req = compileGptHostRequest(research, state, { turn: 1, userMessage: 'claim' })
  const res = {
    schema: 'ppl.gpt-host-response/0.1', message: '提出可检验假设。', citations: [],
    action: { kind: 'claim-proposal', conclusionStatus: null, conclusionDirection: null, rationale: 'proposal', claim: { id: 'c1', text: 'Claim', kind: 'hypothesis' }, plan: null },
  }
  return applyResearchModelResponse(research, state, req, res).state
}

test('0.1.8 Judge contract constrains evidenceQuote to exact Host-generated agent-message candidates', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { turn: 1, userMessage: 'hint' })
  const draft = {
    schema: 'ppl.gpt-host-response/0.1',
    message: '第一句提示。第二句仍然不要给最终答案。',
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'hint' }, citations: [],
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { allowFinalAnswer: false, rubric: { expectedAnswer: 'x' } })
  const enumValues = judgeReq.responseContract.jsonSchema.properties.violations.items.properties.evidenceQuote.enum
  assert.deepEqual(enumValues, judgeReq.evidenceQuoteCandidates)
  assert.equal(enumValues.includes('第一句提示。'), true)
  assert.equal(enumValues.every(x => draft.message.includes(x)), true)
})

test('0.1.8 Research Judge receives Host epistemic context and same-turn tool artifacts', () => {
  let state = researchWithClaim()
  state = applyResearchHostEvent(research, state, {
    type: 'EVIDENCE_RECORDED', id: 'e1', payload: {
      evidenceId: 'e1', claimId: 'c1', stance: 'support', summary: 'supports',
      source: { locator: 'app://A' }, independenceGroup: 'lab-A', quality: { relevance: 1, reliability: 1, independence: 1 },
    },
  }, { turn: 2 }).state
  const agentReq = compileGptHostRequest(research, state, { turn: 3, userMessage: 'continue' })
  const agentRes = {
    schema: 'ppl.gpt-host-response/0.1', message: '当前证据存在冲突，需要继续验证。', citations: ['app://A'],
    action: { kind: 'research-plan', conclusionStatus: state.research.conclusionStatus, conclusionDirection: state.research.conclusionDirection, rationale: 'conflict', claim: null, plan: 'validate' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(agentReq, agentRes, {
    sameTurnToolResults: [{ output: { event: { type: 'EVIDENCE_RECORDED', id: 'e2', payload: { evidenceId: 'e2', stance: 'oppose', summary: 'opposes', source: { locator: 'app://B' } } } } }],
  })
  assert.equal(judgeReq.immutablePolicy.evidence[0].locator, 'app://A')
  assert.equal(judgeReq.immutablePolicy.sameTurnHostToolArtifacts[0].id, 'e2')
  assert.equal(judgeReq.immutablePolicy.sameTurnHostToolArtifacts[0].stance, 'oppose')
})

test('0.1.8 Research active-claim workflow narrows actions and mirrors Host conclusion fields in JSON Schema', () => {
  const state = researchWithClaim()
  const req = compileGptHostRequest(research, state, { turn: 2, userMessage: 'next' })
  assert.deepEqual(req.responseContract.actionKinds, ['research-plan'])
  const action = req.responseContract.jsonSchema.properties.action.properties
  assert.deepEqual(action.kind.enum, ['research-plan'])
  assert.deepEqual(action.conclusionStatus.enum, [state.research.conclusionStatus])
  assert.deepEqual(action.conclusionDirection.enum, [state.research.conclusionDirection])
})

test('0.1.8 policy retry carries blocked spans and narrows Tutor retry message length', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { turn: 1, userMessage: '只给提示' })
  const decision = {
    status: 'blocked', reason: 'policy-violation',
    violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', severity: 'error', evidenceQuote: '最终答案是 X', detail: 'leak' }],
  }
  const retry = compileRetryRequest(req, decision, { attempt: 1 })
  assert.deepEqual(retry.retry.blockedEvidenceQuotes, ['最终答案是 X'])
  assert.equal(retry.retry.correctionMode, 'host-owned-policy-retry')
  assert.equal(retry.responseContract.jsonSchema.properties.message.maxLength, 480)
  assert.equal(retry.instructions.some(x => x.includes('one concise diagnostic hint/question')), true)
})

test('0.1.8 final Research ready workflow allows report while keeping Host-owned conclusion mirror', () => {
  let state = researchWithClaim()
  for (const [id, stance, group] of [['e1','support','g1'],['e2','oppose','g2'],['e3','support','g4']]) {
    state = applyResearchHostEvent(research, state, { type: 'EVIDENCE_RECORDED', id, payload: {
      evidenceId: id, claimId: 'c1', stance, summary: id, source: { locator: `app://${id}` }, independenceGroup: group,
      quality: { relevance: 1, reliability: 1, independence: 1 },
    } }, { turn: 2 }).state
  }
  state = applyResearchHostEvent(research, state, { type: 'VALIDATION_RESULT', id: 'v1', payload: {
    validationId: 'v1', claimId: 'c1', kind: 'experiment', method: 'rerun', outcome: 'support', confidence: 0.99,
    reproducible: true, strong: true, strongMethod: true, independenceGroup: 'g3', provenanceComplete: true, provenance: { locator: 'app://v1' },
  } }, { turn: 3 }).state
  state = applyResearchHostEvent(research, state, { type: 'CONCLUSION_REQUESTED', id: 'c-final', payload: { claimId: 'c1' } }, { turn: 4 }).state
  const req = compileGptHostRequest(research, state, { turn: 5, userMessage: 'report' })
  assert.equal(req.responseContract.actionKinds.includes('report'), true)
  assert.deepEqual(req.responseContract.jsonSchema.properties.action.properties.conclusionStatus.enum, [state.research.conclusionStatus])
  assert.deepEqual(req.responseContract.jsonSchema.properties.action.properties.conclusionDirection.enum, [state.research.conclusionDirection])
})
