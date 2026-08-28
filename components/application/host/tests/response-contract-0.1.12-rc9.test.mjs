import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  GPT_HOST_RESPONSE_SCHEMA,
  compileGptHostRequest,
  compileAgentPolicyJudgeRequest,
  compileRetryRequest,
  validateGptHostResponse,
  applyResearchHostEvent,
} from '../src/index.mjs'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(fs.readFileSync(new URL('../profiles/research.profile.json', import.meta.url)))

function questionState() {
  return applyResearchHostEvent(research, structuredClone(research.initialState), {
    type: 'QUESTION_DEFINED', id: 'q:rc9', payload: { question: 'Is method A more stable than method B?' },
  }, { turn: 1, step: 0 }).state
}

test('RC9 detects S1.8 Tutor next-practice meta commentary that does not give an actionable checkpoint', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '第 5 组异分母加法我已经独立完成。请给一个同技能的下一步练习或检查点，不给最终答案，也不要复述内部学习状态数值。',
    task: { prompt: '根据累计证据安排第 5 组后的异分母分数加法下一步。', groundTruth: ['异分母分数相加必须先通分，再相加分子。'] },
    rubric: { expectedAnswer: 'withheld', leakPatterns: [] },
    allowFinalAnswer: false,
  })
  const draft = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '好的，既然你已经完成了第 5 组，那么接下来的步骤应该是针对这一技能的巩固或拓展。我们需要安排一个同技能的下一步练习或检查点。',
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: '安排下一步练习。' },
    citations: [],
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: { expectedAnswer: 'withheld', leakPatterns: [] }, allowFinalAnswer: false })
  assert.ok(judgeReq.deterministicViolations.some(v => v.code === 'TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE'))
  const retry = compileRetryRequest(req, {
    status: 'blocked', reason: 'policy-violation',
    violations: judgeReq.deterministicViolations,
  }, { previousResponse: draft })
  assert.equal(retry.responseContract.hostOwnedMessage, true)
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.match(safe, /(?:下一步检查点|Next checkpoint)/u)
  assert.match(safe, /(?:请你自己选|choose two fractions)/iu)
})

test('RC9 does not flag an actually actionable unsolved next checkpoint', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '请给一个同技能的下一步练习或检查点，不给最终答案。',
    task: { prompt: '安排下一步异分母分数加法练习。' },
    rubric: { expectedAnswer: 'withheld', leakPatterns: [] },
    allowFinalAnswer: false,
  })
  const draft = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '下一步检查点：请你自己选两个分母不同的分数，只把它们改写为共同分母；先不要算最终和。',
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: '给出下一检查点。' },
    citations: [],
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: { expectedAnswer: 'withheld', leakPatterns: [] }, allowFinalAnswer: false })
  assert.equal(judgeReq.deterministicViolations.some(v => v.code === 'TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE'), false)
})

test('RC9 requires a claim-proposal to surface the exact canonical claim in the user-visible message', () => {
  const state = questionState()
  const req = compileGptHostRequest(research, state, { userMessage: '建立一个可检验的 canonical hypothesis。只提出假设，不宣称已被证明。' })
  const claim = { id: 'claim:rc9', text: 'Method A is more stable than method B under repeated controlled experiments.', kind: 'hypothesis' }
  const draft = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '生成可检验的 canonical hypothesis，仅提出假设，不宣称已被证明。',
    action: { kind: 'claim-proposal', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'establish claim', claim, plan: null },
    citations: [],
  }
  assert.equal(validateGptHostResponse(req, draft).valid, true)
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft)
  const missing = judgeReq.deterministicViolations.find(v => v.code === 'RESEARCH_CLAIM_NOT_VISIBLE')
  assert.ok(missing)
  const retry = compileRetryRequest(req, { status: 'blocked', reason: 'policy-violation', violations: [missing] }, { previousResponse: draft })
  assert.equal(retry.responseContract.hostOwnedMessage, true)
  assert.equal(retry.responseContract.hostOwnedAction, true)
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.ok(safe.includes(claim.text))
  assert.deepEqual(retry.responseContract.jsonSchema.properties.action.properties.claim.properties.text.enum, [claim.text])
})
