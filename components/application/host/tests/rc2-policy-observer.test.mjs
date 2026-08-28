import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  GPT_HOST_RESPONSE_SCHEMA, GPT_OBSERVER_RESPONSE_SCHEMA,
  GPT_POLICY_JUDGE_RESPONSE_SCHEMA, POLICY_CODE_VALUES,
  compileGptHostRequest, compileTutorObserverRequest, materializeTutorObservationFromObserver,
  createHostSource, compileResearchEvidenceJudgeRequest, materializeResearchEvidenceFromJudge,
  compileAgentPolicyJudgeRequest, validateAgentPolicyJudgeResponse, decideAgentDelivery, compileRetryRequest,
  applyTutorModelResponse,
} from '../src/index.mjs'

const tutor = JSON.parse(await readFile(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(await readFile(new URL('../profiles/research.profile.json', import.meta.url)))

const fractionRubric = {
  expectedAnswer: '11/12',
  criteria: 'Use a common denominator and add only numerators after denominators match.',
  misconceptionTaxonomy: [
    { id: 'add_numerators_and_denominators' },
    { id: 'common_denominator_not_required' },
  ],
}

test('RC2 tutor observer can return unscorable without mutating learner evidence', () => {
  const req = compileTutorObserverRequest(tutor, tutor.initialState, {
    skillId: 'fractions.addition', prompt: '3/4 + 1/6 = ?', rubric: fractionRubric,
    learnerResponse: '我不会，能先给一个提示吗？',
  })
  const out = materializeTutorObservationFromObserver(req, {
    schema: GPT_OBSERVER_RESPONSE_SCHEMA, verdict: 'unscorable', confidence: 0.98, reason: 'help-request-without-answer',
  })
  assert.equal(out.accepted, false)
  assert.equal(out.reason, 'help-request-without-answer')
})

test('RC2 tutor observer rejects invented misconception outside Host taxonomy', () => {
  const req = compileTutorObserverRequest(tutor, tutor.initialState, {
    skillId: 'fractions.addition', prompt: '3/4 + 1/6 = ?', rubric: fractionRubric,
    learnerResponse: '我觉得答案是 4/10，因为上下都相加。',
  })
  assert.throws(() => materializeTutorObservationFromObserver(req, {
    schema: GPT_OBSERVER_RESPONSE_SCHEMA, verdict: 'incorrect', score: 0, confidence: 0.96,
    misconception: { id: 'learner_is_lazy', confidence: 0.9, evidenceQuote: '上下都相加' },
  }), /not in Host taxonomy/)
})

test('RC2 tutor misconception must be anchored to an exact learner-response span', () => {
  const req = compileTutorObserverRequest(tutor, tutor.initialState, {
    skillId: 'fractions.addition', prompt: '3/4 + 1/6 = ?', rubric: fractionRubric,
    learnerResponse: '我觉得答案是 4/10，因为上下都相加。',
  })
  assert.throws(() => materializeTutorObservationFromObserver(req, {
    schema: GPT_OBSERVER_RESPONSE_SCHEMA, verdict: 'incorrect', score: 0, confidence: 0.96,
    misconception: { id: 'add_numerators_and_denominators', confidence: 0.9, evidenceQuote: '把两个分母直接相加' },
  }), /exact learner-response span/)
})

test('RC2 partial tutor answer preserves rubric score and anchored misconception evidence', () => {
  const learnerResponse = '先通分成12：3/4=9/12，1/6=2/12，但最后一步我忘了。'
  const req = compileTutorObserverRequest(tutor, tutor.initialState, {
    skillId: 'fractions.addition', prompt: '3/4 + 1/6 = ?', rubric: fractionRubric, learnerResponse,
  })
  const out = materializeTutorObservationFromObserver(req, {
    schema: GPT_OBSERVER_RESPONSE_SCHEMA, verdict: 'partial', score: 0.75, confidence: 0.97,
    rationale: 'Common-denominator reasoning is correct; final addition is missing.',
  })
  assert.equal(out.accepted, true)
  assert.equal(out.assessment.score, 0.75)
  assert.equal(out.assessment.correct, false)
})

test('RC2 Host-fetched research source is digest locked and Judge cannot replace provenance', () => {
  const hostSource = createHostSource({
    source: { title: 'Study', doi: '10.1/real', publisher: 'Journal' },
    summary: 'The registered replication did not reproduce the predicted effect.',
    retrievedAt: '2026-08-19T12:00:00Z', reliability: 0.95, independenceGroup: 'lab-b',
  })
  const req = compileResearchEvidenceJudgeRequest(research, research.initialState, { hostSource, evidenceId: 'e1' })
  assert.equal(req.sourceDigest, hostSource.digest)
  const out = materializeResearchEvidenceFromJudge(req, {
    schema: GPT_OBSERVER_RESPONSE_SCHEMA, stance: 'oppose', relevance: 0.95, confidence: 0.98,
    summary: 'The replication did not reproduce the predicted effect.',
  }, { evidenceId: 'e1', claimId: 'claim-x' })
  assert.equal(out.event.payload.source.doi, '10.1/real')
  assert.equal(out.event.payload.source.digest, hostSource.digest)
})

test('RC2 deterministic Tutor final-answer leak blocks a structurally valid draft', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { requestId: 'tutor:leak', turn: 1, userMessage: '给我一点提示' })
  const draft = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '提示：先通分。最终答案是 11/12。',
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'help' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: fractionRubric, allowFinalAnswer: false })
  const judgeRes = {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 0.99,
    violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', evidenceQuote: judgeReq.evidenceQuoteCandidates.find(x => x.includes('最终答案是 11/12')) || judgeReq.evidenceQuoteCandidates[0], rationale: 'Reveals target answer.' }],
  }
  const decision = decideAgentDelivery(req, draft, judgeReq, judgeRes)
  assert.equal(decision.status, 'blocked')
  assert.equal(decision.violations.some(x => x.code === 'TUTOR_FINAL_ANSWER_LEAK'), true)
})

test('RC2 retry preserves Profile policy and only accepted retry can become intervention state', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { requestId: 'tutor:retry', turn: 1, userMessage: '提示一下' })
  const bad = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '答案就是 11/12。',
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'leak' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, bad, { rubric: fractionRubric })
  const judgeRes = {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 0.99,
    violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', evidenceQuote: judgeReq.evidenceQuoteCandidates[0], rationale: 'Target answer disclosed.' }],
  }
  const decision = decideAgentDelivery(req, bad, judgeReq, judgeRes)
  const retry = compileRetryRequest(req, decision)
  assert.equal(retry.policy.mode, req.policy.mode)
  assert.equal(retry.policy.hintLevel, req.policy.hintLevel)
  const good = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '先找 4 和 6 的共同分母，只完成通分这一步。',
    action: { kind: 'tutor-intervention', policyMode: retry.policy.mode, rationale: 'minimal hint' },
  }
  const goodJudgeReq = compileAgentPolicyJudgeRequest(retry, good, { rubric: fractionRubric })
  const goodJudgeRes = { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: true, confidence: 0.98, violations: [] }
  assert.equal(decideAgentDelivery(retry, good, goodJudgeReq, goodJudgeRes).status, 'deliver')
  const applied = applyTutorModelResponse(tutor, tutor.initialState, retry, good)
  assert.equal(applied.state.pedagogy.interventions.length, 1)
  assert.equal(applied.state.pedagogy.interventions[0].strategy, req.policy.mode)
})

test('RC2 low-confidence policy judgment cannot silently deliver', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { requestId: 'tutor:review', turn: 1, userMessage: '解释一下' })
  const draft = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '先比较两个分数的单位大小。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode } }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: fractionRubric })
  const judgeRes = { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: true, confidence: 0.55, violations: [] }
  assert.equal(decideAgentDelivery(req, draft, judgeReq, judgeRes).status, 'review')
})

test('RC2 Research certainty-overreach can be blocked using exact output evidence quote', () => {
  const req = compileGptHostRequest(research, research.initialState, { requestId: 'research:overclaim', turn: 1, userMessage: '总结' })
  const draft = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '这个结论已经被彻底证明，不需要进一步验证。', action: { kind: 'research-plan' } }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft)
  const judgeRes = {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 0.96,
    violations: [{ code: 'RESEARCH_CERTAINTY_OVERREACH', evidenceQuote: judgeReq.evidenceQuoteCandidates[0], rationale: 'Claim exceeds current Profile gate.' }],
  }
  assert.equal(validateAgentPolicyJudgeResponse(judgeReq, judgeRes).valid, true)
  assert.equal(decideAgentDelivery(req, draft, judgeReq, judgeRes).status, 'blocked')
})

test('RC2 source content digest is stable across retrieval times while retrievalId changes', () => {
  const common = { source: { doi: '10.1/stable' }, summary: 'Same fetched content.', reliability: 0.9 }
  const a = createHostSource({ ...common, retrievedAt: '2026-08-19T10:00:00Z' })
  const b = createHostSource({ ...common, retrievedAt: '2026-08-19T11:00:00Z' })
  assert.equal(a.digest, b.digest)
  assert.notEqual(a.retrievalId, b.retrievalId)
})

test('RC2 tampered Host source is rejected before Research Judge invocation', () => {
  const source = createHostSource({ source: { doi: '10.1/tamper' }, summary: 'Original text.', retrievedAt: '2026-08-19T10:00:00Z' })
  source.sourceText = 'Tampered text.'
  assert.throws(() => compileResearchEvidenceJudgeRequest(research, research.initialState, { hostSource: source }), /digest mismatch/)
})

test('RC2 tutor nonintervention response does not enter intervention ledger', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { requestId: 'tutor:pause', turn: 1, userMessage: '先停一下' })
  const res = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '可以，先停。', action: { kind: 'tutor-nonintervention', rationale: 'pause' } }
  const out = applyTutorModelResponse(tutor, tutor.initialState, req, res)
  assert.equal(out.event, null)
  assert.equal(out.finalized.status, 'no-state-mutation')
  assert.equal(out.state.pedagogy.interventions.length, 0)
})

test('0.1.1 hotfix: Tutor prompt operand equal to expected answer is not deterministically misclassified as final-answer leak', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { requestId: 'tutor:operand-regression', turn: 1, userMessage: '比较 3/4 和 2/3，先给提示，不要直接说哪个更大。' })
  const draft = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '把 3/4 和 2/3 都化成分母为 12 的等值分数，先只写两个新分子。',
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'diagnostic comparison step' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: { expectedAnswer: '3/4', acceptedAnswers: ['3/4 更大'] }, allowFinalAnswer: false })
  assert.equal(judgeReq.deterministicViolations.length, 0)
})

test('0.1.1 hotfix: Host-defined leakPatterns remain deterministic even when answer token occurs in prompt', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { requestId: 'tutor:pattern-regression', turn: 1, userMessage: '比较 3/4 和 2/3。' })
  const draft = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '最后结论：3/4 更大。',
    action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'bad' },
  }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: { expectedAnswer: '3/4', leakPatterns: ['3/4 更大'] }, allowFinalAnswer: false })
  assert.equal(judgeReq.deterministicViolations.length, 1)
  assert.equal(judgeReq.deterministicViolations[0].evidenceQuote, '3/4 更大')
})


test('0.1.4 judge contract: Host publishes role-scoped taxonomy and Host-owned severity', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { requestId: 'judge:contract', turn: 1, userMessage: '只给提示' })
  const draft = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '先通分，不给最终结论。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'hint' } }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: fractionRubric, allowFinalAnswer: false })
  assert.equal(judgeReq.allowedPolicyCodes.includes('TUTOR_FINAL_ANSWER_LEAK'), true)
  assert.equal(judgeReq.allowedPolicyCodes.includes('RESEARCH_CERTAINTY_OVERREACH'), false)
  assert.deepEqual(judgeReq.responseContract.jsonSchema.properties.violations.items.properties.code.enum, judgeReq.allowedPolicyCodes)
  assert.equal('severity' in judgeReq.responseContract.jsonSchema.properties.violations.items.properties, false)
  assert.equal(judgeReq.policyCodeDefinitions.TUTOR_FINAL_ANSWER_LEAK.severity, 'error')
  assert.equal(judgeReq.responseRules.evidenceQuoteMustBeExactContiguousAgentMessageSpan, true)
  assert.equal(judgeReq.responseRules.severityIsHostOwnedAndMustNotBeReturnedByJudge, true)
  assert.equal(judgeReq.authority.modelMustNot.includes('choose-policy-severity'), true)
  assert.equal(judgeReq.instructions.some(x => x.includes('evidenceQuoteCandidates')), true)
})

test('0.1.4 judge contract: research taxonomy excludes Tutor codes and defines certainty overreach', () => {
  const req = compileGptHostRequest(research, research.initialState, { requestId: 'judge:research-contract', turn: 1, userMessage: '总结' })
  const draft = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '证据不足，暂时不能下结论。', action: { kind: 'research-plan' } }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft)
  assert.equal(judgeReq.allowedPolicyCodes.includes('RESEARCH_CERTAINTY_OVERREACH'), true)
  assert.equal(judgeReq.allowedPolicyCodes.includes('TUTOR_FINAL_ANSWER_LEAK'), false)
  assert.match(judgeReq.policyCodeDefinitions.RESEARCH_CERTAINTY_OVERREACH.definition, /proven|certain|settled/i)
})

test('0.1.3 judge contract: compliant=true cannot carry invented warning violations', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { requestId: 'judge:compliant', turn: 1, userMessage: '只给提示' })
  const draft = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '先通分，不给最终结论。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'hint' } }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: fractionRubric, allowFinalAnswer: false })
  const out = validateAgentPolicyJudgeResponse(judgeReq, {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: true, confidence: 0.95,
    violations: [{ code: 'OTHER_POLICY_VIOLATION', evidenceQuote: '先通分', rationale: 'spurious' }],
  })
  assert.equal(out.valid, false)
  assert.equal(out.errors.includes('compliant policy judge response must have empty violations'), true)
})

test('0.1.3 judge contract: noncompliant=false requires at least one exact anchored violation', () => {
  const req = compileGptHostRequest(research, research.initialState, { requestId: 'judge:noncompliant', turn: 1, userMessage: '总结' })
  const draft = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '这个结论已经被彻底证明。', action: { kind: 'research-plan' } }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft)
  const missing = validateAgentPolicyJudgeResponse(judgeReq, { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 0.95, violations: [] })
  assert.equal(missing.valid, false)
  assert.equal(missing.errors.includes('noncompliant policy judge response requires at least one violation'), true)
  const anchored = validateAgentPolicyJudgeResponse(judgeReq, {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 0.95,
    violations: [{ code: 'RESEARCH_CERTAINTY_OVERREACH', evidenceQuote: judgeReq.evidenceQuoteCandidates[0], rationale: 'overclaim' }],
  })
  assert.equal(anchored.valid, true)
})

test('0.1.4 judge contract: Judge cannot choose severity; Host materializes severity from taxonomy', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { requestId: 'judge:severity', turn: 1, userMessage: '只给提示' })
  const draft = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '最终答案是 11/12。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'bad' } }
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { rubric: fractionRubric, allowFinalAnswer: false })
  const modelOwnedSeverity = validateAgentPolicyJudgeResponse(judgeReq, {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 0.99,
    violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', severity: 'warning', evidenceQuote: judgeReq.evidenceQuoteCandidates[0], rationale: 'leak' }],
  })
  assert.equal(modelOwnedSeverity.valid, false)
  assert.equal(modelOwnedSeverity.errors.includes('policy violation severity is Host-owned and must not be returned by Judge'), true)
  const decision = decideAgentDelivery(req, draft, judgeReq, {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 0.99,
    violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', evidenceQuote: judgeReq.evidenceQuoteCandidates[0], rationale: 'leak' }],
  })
  assert.equal(decision.status, 'blocked')
  assert.equal(decision.violations.find(v => v.code === 'TUTOR_FINAL_ANSWER_LEAK').severity, 'error')
})

test('0.1.5 responseContract: Host rejects extra Judge properties even when provider only guarantees JSON object syntax', () => {
  const agentRequest = compileGptHostRequest(tutor, tutor.initialState, {
    sessionId: 'contract-json-object', turn: 1,
    userMessage: '比较 3/4 和 2/3，只给提示。', rubric: { expectedAnswer: '3/4' }, allowFinalAnswer: false,
  })
  const agentResponse = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '先把两个分数都化成分母为 12 的等值分数。',
    action: { kind: 'tutor-intervention', policyMode: agentRequest.policy.mode, rationale: 'minimal hint' },
    citations: [],
  }
  const judgeRequest = compileAgentPolicyJudgeRequest(agentRequest, agentResponse, { rubric: { expectedAnswer: '3/4' }, allowFinalAnswer: false })
  const invalid = validateAgentPolicyJudgeResponse(judgeRequest, {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
    compliant: true,
    confidence: 0.99,
    violations: [],
    unexpectedProviderField: 'must-not-pass-host-contract',
  })
  assert.equal(invalid.valid, false)
  assert.match(invalid.errors.join('\n'), /responseContract: \$\.unexpectedProviderField is not allowed/)
})

test('0.1.5 responseContract: Host accepts a valid Judge JSON object without relying on provider json_schema enforcement', () => {
  const agentRequest = compileGptHostRequest(research, research.initialState, {
    sessionId: 'contract-json-object-research', turn: 1,
    userMessage: '没有证据时是否已证实？',
  })
  const agentResponse = {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message: '目前没有足够证据判断该假设已经被证实。',
    action: { kind: 'research-plan', conclusionStatus: null, conclusionDirection: null, rationale: 'insufficient evidence', claim: null, plan: 'define and test' },
    citations: [],
  }
  const judgeRequest = compileAgentPolicyJudgeRequest(agentRequest, agentResponse)
  const valid = validateAgentPolicyJudgeResponse(judgeRequest, {
    schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
    compliant: true,
    confidence: 0.99,
    violations: [],
  })
  assert.deepEqual(valid, { valid: true, errors: [] })
})
