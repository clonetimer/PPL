import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  GPT_HOST_RESPONSE_SCHEMA,
  GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
  compileGptHostRequest,
  compileAgentPolicyJudgeRequest,
  compileRetryRequest,
  decideAgentDelivery,
} from '../src/index.mjs'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(fs.readFileSync(new URL('../profiles/research.profile.json', import.meta.url)))

function tutorDraft(req, message, rationale = 'task-grounded hint') {
  return { schema: GPT_HOST_RESPONSE_SCHEMA, message, action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale }, citations: [] }
}

function researchPlanDraft(message) {
  return {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message,
    action: { kind: 'research-plan', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'continue validation', claim: null, plan: 'continue validation' },
    citations: [],
  }
}

test('0.1.12 RC5 factual-error retry becomes Host-owned instead of another free Tutor generation', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '5/8 + 3/5 我算错了。请诊断下一步，但不要给最终和。',
    task: { prompt: '诊断异分母分数加法', groundTruth: ['异分母分数相加必须先通分，再相加分子。'] },
  })
  const retry = compileRetryRequest(req, {
    status: 'blocked', reason: 'policy-violation',
    violations: [{ code: 'TUTOR_TASK_FACTUAL_ERROR', evidenceQuote: '5/8 = 10/16' }],
  })
  const messageSchema = retry.responseContract.jsonSchema.properties.message
  const rationaleSchema = retry.responseContract.jsonSchema.properties.action.properties.rationale
  assert.equal(retry.responseContract.hostOwnedMessage, true)
  assert.equal(messageSchema.enum.length, 1)
  assert.equal(rationaleSchema.enum[0], 'host-policy-safe-retry')
  assert.equal(/\d+\s*\/\s*\d+/u.test(messageSchema.enum[0]), false)
})

test('0.1.12 RC5 blocks a solved newly proposed practice when learner asked for an unsolved next checkpoint', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '请给一个同技能的下一步练习或检查点，不给最终答案。',
    task: { prompt: '安排异分母分数加法下一步', groundTruth: ['异分母分数相加必须先通分，再相加分子。'] },
  })
  const message = '继续练习：3/4 + 2/5 = (3×5)/(4×5) + (2×5)/(4×5) = 15/20 + 10/20 = 25/20'
  const draft = tutorDraft(req, message)
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: { expectedAnswer: 'withheld' }, allowFinalAnswer: false })
  assert.ok(judgeReq.deterministicViolations.some(v => v.code === 'TUTOR_EXCESSIVE_ASSISTANCE'))
  const judge = { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: true, confidence: 1, violations: [] }
  const decision = decideAgentDelivery(req, draft, judgeReq, judge)
  assert.equal(decision.status, 'blocked')
})

test('0.1.12 RC5 deterministically blocks S1.4-style directional Research prose under blocked/undetermined Host state', () => {
  const req = compileGptHostRequest(research, structuredClone(research.initialState), { userMessage: '总结当前不确定性。' })
  for (const message of [
    'Method A is less stable than Method B in long-term controlled experiments, although more validation is needed.',
    '研究计划：基于证据K，在长期受控实验中方法A比方法B更稳定。建议继续验证。',
  ]) {
    const draft = researchPlanDraft(message)
    const judgeReq = compileAgentPolicyJudgeRequest(req, draft, {})
    assert.ok(judgeReq.deterministicViolations.some(v => v.code === 'RESEARCH_CONCLUSION_MIRROR_MISMATCH'), message)
  }
})

test('0.1.12 RC5 Research mirror detector preserves hypothesis/question safe harbor', () => {
  const req = compileGptHostRequest(research, structuredClone(research.initialState), { userMessage: '提出可检验假设。' })
  const draft = researchPlanDraft('研究问题：方法 A 是否比方法 B 更稳定？继续收集证据。')
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, {})
  assert.equal(judgeReq.deterministicViolations.some(v => v.code === 'RESEARCH_CONCLUSION_MIRROR_MISMATCH'), false)
})

test('0.1.12 RC5 envelope/mirror Research retry is Host-owned clean prose', () => {
  const req = compileGptHostRequest(research, structuredClone(research.initialState), { userMessage: '调用证据工具后只按当前 Host 状态更新。' })
  const retry = compileRetryRequest(req, {
    status: 'blocked', reason: 'policy-violation',
    violations: [{ code: 'MODEL_RESPONSE_ENVELOPE_LEAK', evidenceQuote: ',"action":{' }],
  })
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.equal(retry.responseContract.hostOwnedMessage, true)
  assert.equal(/"action"\s*:/iu.test(safe), false)
  assert.match(safe, /(?:结论仍未定|conclusion remains undetermined)/iu)
})
