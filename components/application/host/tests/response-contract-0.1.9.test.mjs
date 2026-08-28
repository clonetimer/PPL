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

function researchWithOpposingEvidence() {
  let state = applyResearchHostEvent(research, research.initialState, { type: 'QUESTION_DEFINED', payload: { question: 'Q' } }, { turn: 1 }).state
  const req = compileGptHostRequest(research, state, { turn: 1, userMessage: 'claim' })
  state = applyResearchModelResponse(research, state, req, {
    schema: 'ppl.gpt-host-response/0.1', message: '提出待验证假设。', citations: [],
    action: { kind: 'claim-proposal', conclusionStatus: null, conclusionDirection: null, rationale: 'proposal', claim: { id: 'c1', text: 'Claim', kind: 'hypothesis' }, plan: null },
  }).state
  state = applyResearchHostEvent(research, state, { type: 'EVIDENCE_RECORDED', id: 'e-op', payload: {
    evidenceId: 'e-op', claimId: 'c1', stance: 'oppose', summary: 'Independent experiment B reports no advantage and higher tail variance.',
    source: { locator: 'app://B' }, independenceGroup: 'gB', quality: { relevance: 1, reliability: 1, independence: 1 },
  } }, { turn: 2 }).state
  return state
}

test('0.1.9 deterministic Tutor guard blocks explicit relation/equality leak while allowing ordinary target-token scaffolding', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { turn: 1, userMessage: '比较 3/4 与 3/2，但不要直接给答案。' })
  const leakDraft = {
    schema: 'ppl.gpt-host-response/0.1',
    message: '虽然 3 大于 2，但 3/4 实际上小于 3/2。并且 3/4 = 0.75。',
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'diagnose' }, citations: [],
  }
  const leakJudge = compileAgentPolicyJudgeRequest(req, leakDraft, { allowFinalAnswer: false, rubric: { expectedAnswer: '3/4', leakPatterns: ['3/4 更大'] } })
  assert.equal(leakJudge.deterministicViolations.some(v => v.code === 'TUTOR_FINAL_ANSWER_LEAK'), true)

  const scaffold = { ...leakDraft, message: '先比较 3/4 与 3/2；可以尝试通分或画图，但暂时不要下结论。' }
  const scaffoldJudge = compileAgentPolicyJudgeRequest(req, scaffold, { allowFinalAnswer: false, rubric: { expectedAnswer: '3/4', leakPatterns: ['3/4 更大'] } })
  assert.equal(scaffoldJudge.deterministicViolations.some(v => v.code === 'TUTOR_FINAL_ANSWER_LEAK'), false)
})

test('0.1.9 Policy Judge contract bounds rationale length', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { turn: 1, userMessage: '只给提示' })
  const draft = { schema: 'ppl.gpt-host-response/0.1', message: '先画图比较。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'hint' }, citations: [] }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { allowFinalAnswer: false, rubric: { expectedAnswer: 'x' } })
  const rationale = judgeReq.responseContract.jsonSchema.properties.violations.items.properties.rationale
  assert.equal(rationale.maxLength, 160)
  assert.equal(rationale.minLength, 1)
})

test('0.1.9 Research Judge instructions explicitly protect blocked-state research planning and conflict-preservation statements', () => {
  const state = researchWithOpposingEvidence()
  const req = compileGptHostRequest(research, state, { turn: 3, userMessage: '下一步怎么办？', actionKinds: ['research-plan'] })
  const draft = {
    schema: 'ppl.gpt-host-response/0.1', message: '继续设计独立验证，并明确保留反向证据。', citations: ['app://B'],
    action: { kind: 'research-plan', conclusionStatus: state.research.conclusionStatus, conclusionDirection: state.research.conclusionDirection, rationale: 'keep blocked', claim: null, plan: 'validate' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, {})
  assert.equal(judgeReq.instructions.some(x => x.includes('SAFE HARBOR') && x.includes('research-plan')), true)
  assert.equal(judgeReq.instructions.some(x => x.includes('SAFE HARBOR') && x.includes('counter-evidence')), true)
  assert.match(judgeReq.policyCodeDefinitions.RESEARCH_CERTAINTY_OVERREACH.definition, /NOT certainty overreach/)
  assert.match(judgeReq.policyCodeDefinitions.RESEARCH_CONFLICT_ERASURE.definition, /NOT conflict erasure/)
})

test('0.1.9 Research conflict-erasure retry includes the substance of Host-owned opposing evidence', () => {
  const state = researchWithOpposingEvidence()
  const req = compileGptHostRequest(research, state, { turn: 3, userMessage: '报告', actionKinds: ['report'] })
  const retry = compileRetryRequest(req, {
    status: 'blocked', reason: 'policy-violation',
    violations: [{ code: 'RESEARCH_CONFLICT_ERASURE', severity: 'error', evidenceQuote: 'A is better', detail: 'omits B' }],
  }, { attempt: 1 })
  const correction = retry.instructions.find(x => x.includes('USER-VISIBLE message'))
  assert.ok(correction)
  assert.match(correction, /Independent experiment B reports no advantage and higher tail variance/)
})
