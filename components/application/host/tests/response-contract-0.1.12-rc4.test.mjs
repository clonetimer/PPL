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

function researchDraft(message) {
  return {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message,
    action: { kind: 'research-plan', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'keep uncertainty', claim: null, plan: 'continue validation' },
    citations: [],
  }
}

test('0.1.12 RC4 carries Host-verified Tutor ground truth and can pin a verified user-visible message', () => {
  const verified = '这一步通分方向正确：两个加数已经写成同一分母。请你自己完成最后相加。'
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '我把两个加数通分为 25/40 和 24/40，只检查方向。',
    task: { prompt: '验证异分母加法通分', groundTruth: ['5/8 = 25/40', '3/5 = 24/40', '25/40 与 24/40 已具有共同分母 40'] },
    hostVerifiedTutorMessage: verified,
  })
  assert.deepEqual(req.task.groundTruth, ['5/8 = 25/40', '3/5 = 24/40', '25/40 与 24/40 已具有共同分母 40'])
  assert.equal(req.responseContract.hostOwnedMessage, true)
  assert.deepEqual(req.responseContract.jsonSchema.properties.message.enum, [verified])
  assert.ok(req.instructions.some(x => x.includes('task.groundTruth')))
})

test('0.1.12 RC4 Host-owned safe Tutor copy cannot be rejected by an impossible Judge final-answer-leak false positive', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '不要给最终和。', task: { prompt: '异分母加法' },
  })
  const retry = compileRetryRequest(req, { status: 'blocked', reason: 'policy-violation', violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', evidenceQuote: '17/12' }] })
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  const draft = tutorDraft(retry, safe, 'host-policy-safe-retry')
  const judgeReq = compileAgentPolicyJudgeRequest(retry, draft, { rubric: { expectedAnswer: '17/12' }, allowFinalAnswer: false })
  const quote = judgeReq.evidenceQuoteCandidates.find(x => x.includes('最后结果')) || judgeReq.evidenceQuoteCandidates[0]
  const judge = { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 1, violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', evidenceQuote: quote, rationale: 'false positive from S1.3 shape' }] }
  const decision = decideAgentDelivery(retry, draft, judgeReq, judge)
  assert.equal(decision.status, 'deliver')
  assert.equal(decision.violations.some(x => x.code === 'TUTOR_FINAL_ANSWER_LEAK'), false)
})

test('0.1.12 RC4 deterministically blocks embedded response-envelope fragments in user-visible Research message', () => {
  const req = compileGptHostRequest(research, structuredClone(research.initialState), { userMessage: '给研究计划。' })
  const draft = researchDraft('研究计划","action":{"kind":"research-plan","conclusionStatus":"blocked"}')
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, {})
  assert.ok(judgeReq.deterministicViolations.some(x => x.code === 'MODEL_RESPONSE_ENVELOPE_LEAK'))
  const judge = { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: true, confidence: 1, violations: [] }
  const decision = decideAgentDelivery(req, draft, judgeReq, judge)
  assert.equal(decision.status, 'blocked')
  assert.ok(decision.violations.some(x => x.code === 'MODEL_RESPONSE_ENVELOPE_LEAK'))
})

test('0.1.12 RC4 Research Judge taxonomy blocks a user-visible directional conclusion while Host is blocked/undetermined', () => {
  const req = compileGptHostRequest(research, structuredClone(research.initialState), { userMessage: '总结不确定性。' })
  const draft = researchDraft('Method A is less stable than Method B in long-term controlled experiments. However, more validation is needed.')
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, {})
  assert.ok(judgeReq.allowedPolicyCodes.includes('RESEARCH_CONCLUSION_MIRROR_MISMATCH'))
  assert.ok(judgeReq.instructions.some(x => x.includes('RESEARCH_CONCLUSION_MIRROR_MISMATCH')))
  const quote = judgeReq.evidenceQuoteCandidates.find(x => x.includes('less stable'))
  assert.ok(quote)
  const judge = { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 1, violations: [{ code: 'RESEARCH_CONCLUSION_MIRROR_MISMATCH', evidenceQuote: quote, rationale: 'Host direction is undetermined.' }] }
  const decision = decideAgentDelivery(req, draft, judgeReq, judge)
  assert.equal(decision.status, 'blocked')
})
