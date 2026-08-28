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

function tutorDraft(req, message, rationale = 'host-policy-safe-retry') {
  return {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message,
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale },
    citations: [],
  }
}

test('0.1.12 RC6 Tutor envelope-leak retry is Host-owned and task-aligned for an unsolved next checkpoint', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '第 4 组异分母加法我已经独立完成。请给一个同技能的下一步练习或检查点，不给最终答案，也不要复述内部学习状态数值。',
    task: {
      prompt: '安排异分母分数加法的下一步练习或检查点。',
      context: { skill: 'fractions.addition' },
      groundTruth: ['异分母分数相加必须先把两个加数改写为共同分母，再相加分子。'],
    },
  })
  const retry = compileRetryRequest(req, {
    status: 'blocked',
    reason: 'policy-violation',
    violations: [{ code: 'MODEL_RESPONSE_ENVELOPE_LEAK', evidenceQuote: ',"action":{' }],
  })
  const message = retry.responseContract.jsonSchema.properties.message.enum?.[0]
  assert.equal(retry.responseContract.hostOwnedMessage, true)
  assert.ok(message)
  assert.match(message, /下一步检查点/u)
  assert.match(message, /共同分母/u)
  assert.equal(/[=≈]\s*\d+\s*\/\s*\d+/u.test(message), false)
  assert.deepEqual(retry.responseContract.jsonSchema.properties.action.properties.rationale.enum, ['host-policy-safe-retry'])
})

test('0.1.12 RC6 Host-owned Tutor envelope retry ignores unsupported Judge factual-error false positive', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '第 5 组异分母加法我已经独立完成。请给一个同技能的下一步练习或检查点，不给最终答案。',
    task: {
      prompt: '安排异分母分数加法的下一步练习或检查点。',
      groundTruth: ['异分母分数相加必须先通分，再相加分子。'],
    },
  })
  const retry = compileRetryRequest(req, {
    status: 'blocked',
    reason: 'policy-violation',
    violations: [{ code: 'MODEL_RESPONSE_ENVELOPE_LEAK', evidenceQuote: ',"action":{' }],
  })
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  const draft = tutorDraft(retry, safe)
  const judgeReq = compileAgentPolicyJudgeRequest(retry, draft, {
    rubric: { expectedAnswer: 'withheld' },
    allowFinalAnswer: false,
  })
  const candidate = judgeReq.evidenceQuoteCandidates.find(x => safe.includes(x)) || judgeReq.evidenceQuoteCandidates[0]
  const bogusJudge = {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
    compliant: false,
    confidence: 1,
    violations: [{
      code: 'TUTOR_TASK_FACTUAL_ERROR',
      evidenceQuote: candidate,
      rationale: 'Bogus S1.5-style false positive against a safe checkpoint.',
    }],
  }
  const decision = decideAgentDelivery(retry, draft, judgeReq, bogusJudge)
  assert.equal(decision.status, 'deliver')
  assert.equal(decision.violations.length, 0)
})
