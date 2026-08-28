import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  GPT_HOST_RESPONSE_SCHEMA,
  GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
  compileGptHostRequest,
  compileAgentPolicyJudgeRequest,
  compileRetryRequest,
  compileStructuredRepairRequest,
  decideAgentDelivery,
} from '../src/index.mjs'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url)))

function tutorDraft(req, message, rationale = 'task-grounded hint') {
  return {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message,
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale },
    citations: [],
  }
}

test('0.1.12 RC3 default Tutor generation request exposes policy but not raw learner-state metrics', () => {
  const state = structuredClone(tutor.initialState)
  state.learner.skills.fractions_addition.mean = 0.4097
  state.learner.skills.fractions_addition.uncertainty = 0.541
  state.learner.skills.fractions_addition.directAssessments = 7
  state.learner.misconceptions.compare_surface_features = { id: 'compare-surface-features', status: 'active', confidence: 0.816, evidenceIds: ['e1'] }
  const req = compileGptHostRequest(tutor, state, { userMessage: '只给下一步提示。' })
  const publicContext = JSON.stringify({ durableStateSummary: req.durableStateSummary, policy: req.policy })
  assert.doesNotMatch(publicContext, /0\.4097|0\.541|0\.816|directAssessments|misconceptionStates|compare-surface-features/)
  assert.equal(req.policy.mode, state.pedagogy.recommendedMode)
  assert.equal(req.policy.currentSkillId, 'fractions.addition')
})

test('0.1.12 RC3 explicit Tutor internal-state authorization retains full durable summary', () => {
  const state = structuredClone(tutor.initialState)
  state.learner.skills.fractions_addition.mean = 0.4097
  const req = compileGptHostRequest(tutor, state, { userMessage: '显示内部状态。', allowInternalStateDisclosure: true })
  assert.equal(req.durableStateSummary.model.mean, 0.4097)
})

test('0.1.12 RC3 Tutor initial response contract bounds message and rationale before transport', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), { userMessage: '只给下一步提示。' })
  assert.equal(req.responseContract.jsonSchema.properties.message.maxLength, 640)
  assert.equal(req.responseContract.jsonSchema.properties.action.properties.rationale.maxLength, 200)
})

test('0.1.12 RC3 internal-state safe retry copy contains no privacy-policy meta language', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), { userMessage: '继续提示。' })
  const retry = compileRetryRequest(req, { status: 'blocked', reason: 'policy-violation', violations: [{ code: 'TUTOR_INTERNAL_STATE_DISCLOSURE', evidenceQuote: 'mastery: 0.4' }] })
  const msg = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.doesNotMatch(msg, /内部|状态|mastery|uncertainty|policy|Profile/i)
  assert.match(msg, /当前解法|中间步骤|检查问题|key intermediate|current solution/i)
})

test('0.1.12 RC3 Judge evidenceQuote candidates are bounded and deterministic Host spans are prioritized', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), { userMessage: '只给提示。' })
  const longTail = '这是很长的无关教学文字。'.repeat(80)
  const draft = tutorDraft(req, `当前 mastery: 40.97%。${longTail}`)
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: { expectedAnswer: 'x' }, allowFinalAnswer: false })
  assert.ok(judgeReq.evidenceQuoteCandidates.length > 0)
  assert.ok(judgeReq.evidenceQuoteCandidates.every(x => x.length <= 220))
  assert.match(judgeReq.evidenceQuoteCandidates[0], /mastery.*40\.97%/i)
  assert.equal(judgeReq.responseContract.jsonSchema.properties.violations.items.properties.rationale.maxLength, 160)
})

test('0.1.12 RC3 Tutor Judge taxonomy includes clear task-grounded factual error', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '我在计算 5/8 + 3/5，请只提示下一步。',
    task: { prompt: '异分母分数加法' },
    rubric: { expectedAnswer: '49/40' },
  })
  const draft = tutorDraft(req, '5/8 + 3/5 约等于 2.67，所以先检查是否大于 1。')
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: { expectedAnswer: '49/40' }, allowFinalAnswer: false })
  assert.ok(judgeReq.allowedPolicyCodes.includes('TUTOR_TASK_FACTUAL_ERROR'))
  assert.equal(judgeReq.immutablePolicy.task.prompt, '异分母分数加法')
  const quote = judgeReq.evidenceQuoteCandidates.find(x => x.includes('2.67'))
  assert.ok(quote)
  const judgeResponse = {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
    compliant: false,
    confidence: 1,
    violations: [{ code: 'TUTOR_TASK_FACTUAL_ERROR', evidenceQuote: quote, rationale: '该加法数值明显错误。' }],
  }
  const delivery = decideAgentDelivery(req, draft, judgeReq, judgeResponse)
  assert.equal(delivery.status, 'blocked')
  assert.ok(delivery.violations.some(x => x.code === 'TUTOR_TASK_FACTUAL_ERROR'))
})

test('0.1.12 RC3 structured repair tightens a Tutor retry and a Judge retry without changing schemas', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), { userMessage: '提示。' })
  const repairedAgent = compileStructuredRepairRequest(req, { role: 'agent', attempt: 1 })
  assert.match(repairedAgent.requestId, /structured-repair:1$/)
  assert.equal(repairedAgent.responseContract.jsonSchema.properties.message.maxLength, 480)
  assert.equal(repairedAgent.responseContract.jsonSchema.properties.action.properties.rationale.maxLength, 120)

  const draft = tutorDraft(req, '先检查是否使用了共同分母。')
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, {})
  const repairedJudge = compileStructuredRepairRequest(judgeReq, { role: 'judge', attempt: 1 })
  assert.match(repairedJudge.requestId, /structured-repair:1$/)
  assert.equal(repairedJudge.responseContract.jsonSchema.properties.violations.items.properties.rationale.maxLength, 120)
})
