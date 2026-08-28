import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  GPT_HOST_RESPONSE_SCHEMA,
  compileGptHostRequest,
  compileAgentPolicyJudgeRequest,
  compileRetryRequest,
} from '../src/index.mjs'

const research = JSON.parse(fs.readFileSync(new URL('../profiles/research.profile.json', import.meta.url)))

function researchReq(userMessage = '调用 Host 证据工具并按当前状态更新。') {
  return compileGptHostRequest(research, structuredClone(research.initialState), { userMessage })
}
function planDraft(message) {
  return {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message,
    action: { kind: 'research-plan', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'continue', claim: null, plan: 'continue' },
    citations: [],
  }
}
const evidenceF = [{
  output: { event: { type: 'EVIDENCE_RECORDED', id: 'evidence:F', payload: {
    evidenceId: 'evidence:F', claimId: 'claim:x', stance: 'support',
    summary: 'Experiment F reports a stability advantage under a second metric.',
    source: { locator: 'app://research/s1/source-F', title: 'Sustained Experiment F' },
  } } },
}]
const validationV1 = [{
  output: { event: { type: 'VALIDATION_RESULT', id: 'validation:V1', payload: {
    validationId: 'validation:V1', claimId: 'claim:x', outcome: 'support', strong: true, reproducible: true,
    provenance: { locator: 'app://research/s1/validation-V1' },
  } } },
}]

test('RC10 blocks a same-turn evidence result that disappears from user-visible Research prose', () => {
  const req = researchReq('调用 Host 证据工具获取 evidence:F。把它保留为 support evidence。')
  const draft = planDraft('当前结论仍未定，下一步继续获取独立证据。')
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { sameTurnToolResults: evidenceF })
  const v = judgeReq.deterministicViolations.find(x => x.code === 'RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE')
  assert.ok(v)
  assert.match(v.detail, /Experiment F reports a stability advantage under a second metric\./)
})

test('RC10 accepts same-turn evidence when the Host-owned summary is user-visible', () => {
  const req = researchReq('调用 Host 证据工具获取 evidence:F。把它保留为 support evidence。')
  const draft = planDraft('本轮 evidence:F：Experiment F reports a stability advantage under a second metric. 当前结论仍未定。')
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, { sameTurnToolResults: evidenceF })
  assert.equal(judgeReq.deterministicViolations.some(x => x.code === 'RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE'), false)
})

test('RC10 validation visibility requires the same-turn validation identity and outcome', () => {
  const req = researchReq('调用 Host 强验证工具 validation:V1。说明它如何改变当前判断。')
  const bad = compileAgentPolicyJudgeRequest(req, planDraft('本轮强验证完成，当前结论仍未定。'), { sameTurnToolResults: validationV1 })
  assert.ok(bad.deterministicViolations.some(x => x.code === 'RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE'))
  const good = compileAgentPolicyJudgeRequest(req, planDraft('本轮 validation:V1 的 outcome=support；当前结论仍未定。'), { sameTurnToolResults: validationV1 })
  assert.equal(good.deterministicViolations.some(x => x.code === 'RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE'), false)
})

test('RC10 Host-owned Research repair surfaces same-turn evidence without re-inventing it', () => {
  const req = researchReq('调用 Host 证据工具获取 evidence:F。把它保留为 support evidence。')
  req.evidence = [{ evidenceId: 'evidence:B', stance: 'oppose', summary: 'Experiment B reports no stability advantage and higher tail variance for method A.', source: { locator: 'app://research/s1/source-B', title: 'B' } }]
  const retry = compileRetryRequest(req, {
    status: 'blocked', reason: 'policy-violation', violations: [
      { code: 'RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE', evidenceQuote: '当前结论仍未定。' },
      { code: 'RESEARCH_CONFLICT_ERASURE', evidenceQuote: '当前结论仍未定。' },
    ],
  }, { sameTurnToolResults: evidenceF, previousResponse: planDraft('当前结论仍未定。') })
  assert.equal(retry.responseContract.hostOwnedMessage, true)
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.match(safe, /Experiment F reports a stability advantage under a second metric\./)
  assert.match(safe, /Experiment B reports no stability advantage and higher tail variance for method A\./)
})

test('RC10 same-turn validation repair also preserves explicitly requested all opposing evidence', () => {
  const req = researchReq('调用 Host 强验证工具 validation:V1。说明它如何改变当前判断，同时保留所有反向证据。')
  req.evidence = [{ evidenceId: 'evidence:B', stance: 'oppose', summary: 'Experiment B reports no stability advantage and higher tail variance for method A.', source: { locator: 'app://research/s1/source-B', title: 'B' } }]
  assert.equal(req.responseContract.opposingEvidenceDisclosure, 'all')
  const retry = compileRetryRequest(req, {
    status: 'blocked', reason: 'policy-violation', violations: [
      { code: 'RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE', evidenceQuote: '当前结论仍未定。' },
    ],
  }, { sameTurnToolResults: validationV1, previousResponse: planDraft('当前结论仍未定。') })
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.match(safe, /validation:V1/)
  assert.match(safe, /outcome=support/)
  assert.match(safe, /Experiment B reports no stability advantage and higher tail variance for method A\./)
})
