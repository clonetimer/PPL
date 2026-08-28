import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  GPT_HOST_RESPONSE_SCHEMA,
  GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
  compileGptHostRequest,
  compileAgentPolicyJudgeRequest,
  compileRetryRequest,
  validateGptHostResponse,
  decideAgentDelivery,
  validateJsonSchemaContract,
} from '../src/index.mjs'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(fs.readFileSync(new URL('../profiles/research.profile.json', import.meta.url)))

function researchConflictState({ status = 'qualified', direction = 'support', nextAction = 'report-with-caveats' } = {}) {
  const s = structuredClone(research.initialState)
  s.research.question = 'Q'
  s.research.activeClaimId = 'c1'
  s.research.claimOrder = ['c1']
  s.research.claims = { c1: {
    id: 'c1', text: 'A is more stable than B', kind: 'hypothesis', status,
    supportMass: 8.835, opposeMass: 3.42, neutralMass: 0, uncertainty: 0.2, evidenceCount: 4,
    independentSourceCount: 4, sourceGroups: ['a','b','c','d'], supportGroups: ['a','c'], opposeGroups: ['b','d'], provenanceComplete: true,
    validation: { attempts: 3, supportive: 3, opposing: 0, inconclusive: 0, reproducibleSupport: 3, reproducibleOppose: 0, strongSupport: 3, strongOppose: 0, last: null },
    decision: { status, direction, reasons: [], counterRatio: 0.387, conflict: { present: true, supportMass: 8.835, opposeMass: 3.42, balanceRatio: 0.387, dominantStance: 'support' } },
    conflict: { present: true, supportMass: 8.835, opposeMass: 3.42, balanceRatio: 0.387, dominantStance: 'support' },
  } }
  s.research.evidenceLedger = [
    { evidenceId: 'A', claimId: 'c1', stance: 'support', summary: 'Source A reports a stability advantage for method A.', source: { locator: 'app://a' }, quality: { group: 'a' }, provenanceComplete: true },
    { evidenceId: 'B', claimId: 'c1', stance: 'oppose', summary: 'Source B reports no stability advantage and increased tail variance for method A.', source: { locator: 'app://b' }, quality: { group: 'b' }, provenanceComplete: true },
    { evidenceId: 'C', claimId: 'c1', stance: 'support', summary: 'Source C supports method A under a larger sample.', source: { locator: 'app://c' }, quality: { group: 'c' }, provenanceComplete: true },
    { evidenceId: 'D', claimId: 'c1', stance: 'oppose', summary: 'Source D finds the apparent benefit disappears under a different protocol.', source: { locator: 'app://d' }, quality: { group: 'd' }, provenanceComplete: true },
  ]
  s.research.evidenceIds = ['A','B','C','D']
  s.research.validationLedger = []
  s.research.conclusionStatus = status
  s.research.conclusionDirection = direction
  s.workflow = { nextAction }
  return s
}

function compliantJudge() {
  return { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: true, confidence: 1, violations: [] }
}

test('0.1.12 report-like Profile nextAction exposes report without changing Profile semantics', () => {
  const req = compileGptHostRequest(research, researchConflictState(), { userMessage: '下一步怎么做？' })
  assert.deepEqual(req.responseContract.actionKinds, ['research-plan', 'report'])
  assert.equal(req.responseContract.requiredActionKind, null)
})

test('0.1.12 explicit user report request requires report even when Profile nextAction is not report-like', () => {
  const state = researchConflictState({ status: 'blocked', direction: 'undetermined', nextAction: 'seek-independent-evidence' })
  const req = compileGptHostRequest(research, state, { userMessage: '做一次长期 Session 中途报告。必须保留反向证据。' })
  assert.deepEqual(req.responseContract.actionKinds, ['report'])
  assert.equal(req.responseContract.requiredActionKind, 'report')
  const plan = {
    schema: GPT_HOST_RESPONSE_SCHEMA, message: '生成长期 Session 中途报告', citations: [],
    action: { kind: 'research-plan', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'plan', claim: null, plan: null },
  }
  assert.equal(validateGptHostResponse(req, plan).valid, false)
})

test('0.1.12 explicit qualified report cannot bypass conflict disclosure guard as research-plan', () => {
  const req = compileGptHostRequest(research, researchConflictState(), { userMessage: '执行结论门禁并给出长期 Session 阶段报告。若有 opposing evidence，用户可见文本必须保留其内容。' })
  const response = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '生成长期 Session 阶段报告', citations: [],
    action: { kind: 'report', conclusionStatus: 'qualified', conclusionDirection: 'support', rationale: 'qualified report', claim: null, plan: null },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, response)
  assert.equal(judgeReq.deterministicViolations.some(v => v.code === 'RESEARCH_CONFLICT_ERASURE'), true)
  const delivery = decideAgentDelivery(req, response, judgeReq, compliantJudge())
  assert.equal(delivery.status, 'blocked')
})

test('0.1.12 Tutor internal-state numeric disclosure is deterministic policy error by default', () => {
  const state = structuredClone(tutor.initialState)
  state.learner.skills.fractions_addition.mean = 0.3952
  state.learner.skills.fractions_addition.uncertainty = 0.6453
  state.learner.skills.fractions_addition.observations = 6
  state.learner.skills.fractions_addition.directAssessments = 4
  state.learner.skills.fractions_addition.assistedAssessments = 2
  const req = compileGptHostRequest(tutor, state, { userMessage: '给一个下一步练习，不要复述内部学习状态数值。' })
  const response = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '当前技能准确率仅为 39.52%，不确定性为 0.6453。请继续练习。', citations: [],
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'test' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, response)
  const spans = judgeReq.deterministicViolations.filter(v => v.code === 'TUTOR_INTERNAL_STATE_DISCLOSURE')
  assert.ok(spans.length >= 2)
  const delivery = decideAgentDelivery(req, response, judgeReq, compliantJudge())
  assert.equal(delivery.status, 'blocked')
})

test('0.1.12 Tutor internal assessment-count disclosure from S1 is blocked', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), { userMessage: '不要复述内部学习状态数值。' })
  const response = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '共 18 次观察，其中直接评估 12 次，辅助评估 6 次。', citations: [],
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'test' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, response)
  assert.equal(judgeReq.deterministicViolations.some(v => v.code === 'TUTOR_INTERNAL_STATE_DISCLOSURE'), true)
})

test('0.1.12 Tutor Host may explicitly authorize internal-state disclosure', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), { userMessage: '告诉我内部 uncertainty 指标。', allowInternalStateDisclosure: true })
  const response = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '内部 uncertainty 为 0.7127。', citations: [],
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'authorized' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, response)
  assert.equal(judgeReq.deterministicViolations.some(v => v.code === 'TUTOR_INTERNAL_STATE_DISCLOSURE'), false)
})

test('0.1.12 Tutor internal-state retry is restricted to Host-owned privacy copy', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), { userMessage: '给下一步练习，不要复述内部数值。' })
  const retry = compileRetryRequest(req, { status: 'blocked', reason: 'policy-violation', violations: [{ code: 'TUTOR_INTERNAL_STATE_DISCLOSURE', evidenceQuote: '准确率 39.52%' }] })
  const msg = retry.responseContract.jsonSchema.properties.message
  const rationale = retry.responseContract.jsonSchema.properties.action.properties.rationale
  assert.equal(msg.enum.length, 1)
  assert.doesNotMatch(msg.enum[0], /内部|mastery|uncertainty|状态数值/)
  assert.deepEqual(rationale.enum, ['host-policy-safe-retry'])
  assert.equal(validateJsonSchemaContract('当前 uncertainty=0.5', msg).valid, false)
})

test('0.1.12 report-or-plan wording does not falsely force report', () => {
  const req = compileGptHostRequest(research, researchConflictState(), {
    userMessage: '给出当前阶段性报告或研究计划，并在用户可见文本中保留冲突证据。',
  })
  assert.deepEqual(req.responseContract.actionKinds, ['research-plan', 'report'])
  assert.equal(req.responseContract.requiredActionKind, null)
  assert.equal(req.responseContract.opposingEvidenceDisclosure, 'one')
})

test('0.1.12 explicit opposing-evidence visibility applies to research-plan, not only report', () => {
  const state = researchConflictState({ status: 'blocked', direction: 'undetermined', nextAction: 'seek-independent-evidence' })
  const req = compileGptHostRequest(research, state, {
    userMessage: '继续下一轮工具验证，同时在用户可见文本中保留反向证据的内容。',
  })
  assert.deepEqual(req.responseContract.actionKinds, ['research-plan'])
  assert.equal(req.responseContract.opposingEvidenceDisclosure, 'one')
  const response = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '继续进行下一轮工具验证。', citations: [],
    action: { kind: 'research-plan', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'continue', claim: null, plan: null },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, response)
  assert.equal(judgeReq.deterministicViolations.some(v => v.code === 'RESEARCH_CONFLICT_ERASURE'), true)
})

test('0.1.12 all opposing evidence means every currently available opposing summary', () => {
  const state = researchConflictState({ status: 'blocked', direction: 'undetermined', nextAction: 'seek-independent-evidence' })
  const req = compileGptHostRequest(research, state, {
    userMessage: '继续研究计划，并在用户可见文本中保留所有反向证据内容。',
  })
  assert.equal(req.responseContract.opposingEvidenceDisclosure, 'all')
  const oneOnly = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: 'Source B reports no stability advantage and increased tail variance for method A.', citations: [],
    action: { kind: 'research-plan', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'one only', claim: null, plan: null },
  }
  const oneJudge = compileAgentPolicyJudgeRequest(req, oneOnly)
  assert.equal(oneJudge.deterministicViolations.some(v => v.code === 'RESEARCH_CONFLICT_ERASURE'), true)

  const all = structuredClone(oneOnly)
  all.message = 'Source B reports no stability advantage and increased tail variance for method A. Source D finds the apparent benefit disappears under a different protocol.'
  const allJudge = compileAgentPolicyJudgeRequest(req, all)
  assert.equal(allJudge.deterministicViolations.some(v => v.code === 'RESEARCH_CONFLICT_ERASURE'), false)
})

test('0.1.12 all-opposing-evidence retry is Host-restricted to all summaries', () => {
  const state = researchConflictState({ status: 'blocked', direction: 'undetermined', nextAction: 'seek-independent-evidence' })
  const req = compileGptHostRequest(research, state, {
    userMessage: '用户可见文本必须保留所有反向证据内容。',
  })
  const retry = compileRetryRequest(req, {
    status: 'blocked', reason: 'policy-violation',
    violations: [{ code: 'RESEARCH_CONFLICT_ERASURE', evidenceQuote: '继续研究' }],
  })
  const allowed = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.match(allowed, /Source B reports no stability advantage/)
  assert.match(allowed, /Source D finds the apparent benefit disappears/)
})

test('0.1.12 do-not-erase opposing evidence is a substantive visibility obligation', () => {
  const state = researchConflictState({ status: 'blocked', direction: 'undetermined', nextAction: 'resolve-or-characterize-conflict' })
  const req = compileGptHostRequest(research, state, {
    userMessage: '基于当前 Host evidence 做阶段性说明；不要抹掉反向证据，并指出仍需验证什么。',
  })
  assert.equal(req.responseContract.opposingEvidenceDisclosure, 'one')
  const response = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '不要抹掉反向证据，并继续验证。', citations: [],
    action: { kind: 'research-plan', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'echo only', claim: null, plan: null },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, response)
  assert.equal(judgeReq.deterministicViolations.some(v => v.code === 'RESEARCH_CONFLICT_ERASURE'), true)
})

test('0.1.12 RC2 blocks Tutor Profile implementation identifiers and confidence disclosure from S1.1 turn 14', () => {
  const req = compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage: '继续下一步练习，不要复述内部学习状态。',
  })
  const response = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '当前 misconceptions.compare_surface_features 状态为 active，置信度为 0.816。下一步继续比较表面特征。',
    citations: [],
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 's1.1 regression' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, response)
  const violations = judgeReq.deterministicViolations.filter(v => v.code === 'TUTOR_INTERNAL_STATE_DISCLOSURE')
  assert.ok(violations.length >= 1)
  assert.ok(violations.some(v => /misconceptions\.compare_surface_features|0\.816/.test(v.evidenceQuote)))
  const delivery = decideAgentDelivery(req, response, judgeReq, compliantJudge())
  assert.equal(delivery.status, 'blocked')
})
