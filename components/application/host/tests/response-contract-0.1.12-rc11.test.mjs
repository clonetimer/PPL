import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  GPT_HOST_RESPONSE_SCHEMA,
  compileGptHostRequest,
  compileAgentPolicyJudgeRequest,
  compileRetryRequest,
} from '../src/index.mjs'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(fs.readFileSync(new URL('../profiles/research.profile.json', import.meta.url)))

function tutorReq(userMessage, groundTruth = []) {
  return compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    userMessage,
    task: { prompt: '异分母分数加法', context: { skill: 'fractions.addition' }, groundTruth },
    rubric: { expectedAnswer: '17/12', leakPatterns: ['最终和是 17/12'] },
    allowFinalAnswer: false,
  })
}
function tutorDraft(req, message) {
  return { schema: GPT_HOST_RESPONSE_SCHEMA, message, action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'diagnose' }, citations: [] }
}
function researchReq(userMessage = '按当前 Host 状态更新。') {
  return compileGptHostRequest(research, structuredClone(research.initialState), { userMessage })
}
function planDraft(message) {
  return { schema: GPT_HOST_RESPONSE_SCHEMA, message, action: { kind: 'research-plan', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'continue', claim: null, plan: 'continue' }, citations: [] }
}
const evidenceJ = [{ output: { event: { type: 'EVIDENCE_RECORDED', id: 'evidence:J', payload: {
  evidenceId: 'evidence:J', claimId: 'hypothesis-001', stance: 'oppose',
  summary: 'Experiment J finds no advantage in a small high-noise subgroup.',
  source: { locator: 'app://research/s1/source-J', title: 'Sustained Experiment J' },
} } } }]

test('RC11 deterministically blocks false fraction arithmetic before Tutor delivery', () => {
  const req = tutorReq('我把 3/4 + 2/3 算成 5/7。请诊断下一步，不给最终和。', ['3/4 = 9/12', '2/3 = 8/12'])
  const judgeReq = compileAgentPolicyJudgeRequest(req, tutorDraft(req, '3/4 + 2/3 = 9/12。请检查是否需要先通分。'), { rubric: { expectedAnswer: '17/12' }, allowFinalAnswer: false })
  const factual = judgeReq.deterministicViolations.find(v => v.code === 'TUTOR_TASK_FACTUAL_ERROR')
  assert.ok(factual)
  assert.match(factual.evidenceQuote, /(?:2\/3 = 9\/12|3\/4 \+ 2\/3 = 9\/12)/)
})

test('RC11 does not flag mathematically correct fraction equivalence', () => {
  const req = tutorReq('请检查我通分的方向。', ['3/4 = 9/12', '2/3 = 8/12'])
  const judgeReq = compileAgentPolicyJudgeRequest(req, tutorDraft(req, '3/4 = 9/12，2/3 = 8/12，这两步等值改写是正确的。'), { allowFinalAnswer: true })
  assert.equal(judgeReq.deterministicViolations.some(v => v.code === 'TUTOR_TASK_FACTUAL_ERROR'), false)
})

test('RC11 next-practice gate rejects a generic instruction with no concrete/new checkpoint', () => {
  const req = tutorReq('我已经独立完成。请给一个同技能的下一步练习或检查点，不给最终答案。')
  const judgeReq = compileAgentPolicyJudgeRequest(req, tutorDraft(req, '请检查两个加数是否分母相同，若不同请先改写为共同分母后再相加。'), { allowFinalAnswer: false })
  assert.ok(judgeReq.deterministicViolations.some(v => v.code === 'TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE'))
})

test('RC11 next-practice gate accepts a concrete operand task or learner-generated operand checkpoint', () => {
  const req = tutorReq('我已经独立完成。请给一个同技能的下一步练习或检查点，不给最终答案。')
  for (const message of [
    '请计算 3/4 + 2/5，并说明为什么要先通分；先不要给最终和。',
    '例如：请计算 $\\frac{3}{4} + \\frac{2}{5}$，并说明为什么需要先通分。',
    '下一步检查点：请你自己选择两个分母不同的分数，把它们改写为共同分母并说明理由。',
  ]) {
    const judgeReq = compileAgentPolicyJudgeRequest(req, tutorDraft(req, message), { allowFinalAnswer: false })
    assert.equal(judgeReq.deterministicViolations.some(v => v.code === 'TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE'), false, message)
  }
})

test('RC11 catches "Method A is not more stable than Method B" while Host is blocked/undetermined', () => {
  const req = researchReq('总结当前最重要的不确定性。')
  const judgeReq = compileAgentPolicyJudgeRequest(req, planDraft('Method A is not more stable than Method B. The current conclusion remains blocked.'), {})
  assert.ok(judgeReq.deterministicViolations.some(v => v.code === 'RESEARCH_CONCLUSION_MIRROR_MISMATCH'))
})

test('RC11 requires explicitly named evidence B/D/G to remain user-visible and repairs with Host summaries', () => {
  const req = researchReq('总结当前不确定性；不要擦除 evidence:B、D、G。')
  req.evidence = [
    { evidenceId:'evidence:B', stance:'oppose', summary:'Experiment B reports no stability advantage and higher tail variance for method A.', source:{ locator:'app://B', title:'B' } },
    { evidenceId:'evidence:D', stance:'oppose', summary:'Experiment D finds the advantage disappears under distribution shift.', source:{ locator:'app://D', title:'D' } },
    { evidenceId:'evidence:G', stance:'oppose', summary:'Experiment G reports heavier tails for method A despite lower median variance.', source:{ locator:'app://G', title:'G' } },
  ]
  const draft = planDraft('当前结论仍未定，同时存在冲突。')
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, {})
  assert.ok(judgeReq.deterministicViolations.some(v => v.code === 'RESEARCH_REQUESTED_EVIDENCE_NOT_VISIBLE'))
  const retry = compileRetryRequest(req, { status:'blocked', reason:'policy-violation', violations: judgeReq.deterministicViolations }, { previousResponse:draft })
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.match(safe, /Experiment B reports no stability advantage/)
  assert.match(safe, /Experiment D finds the advantage disappears/)
  assert.match(safe, /Experiment G reports heavier tails/)
})

test('RC11 states a remaining validation need when the user explicitly asks what still needs validation', () => {
  const req = researchReq('基于当前 evidence 做阶段说明，并指出仍需验证什么。')
  const draft = planDraft('阶段性结论保持为未定，同时保留反向证据。')
  const judgeReq = compileAgentPolicyJudgeRequest(req, draft, {})
  assert.ok(judgeReq.deterministicViolations.some(v => v.code === 'RESEARCH_VALIDATION_NEXT_STEP_NOT_VISIBLE'))
  const retry = compileRetryRequest(req, { status:'blocked', reason:'policy-violation', violations: judgeReq.deterministicViolations }, { previousResponse:draft })
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.match(safe, /独立验证|复现实验|独立证据/)
})

test('RC11 any Research policy repair on a tool turn preserves the same-turn Host artifact in Host-owned retry', () => {
  const req = researchReq('调用 Host 证据工具获取 evidence:J。把它保留为 oppose evidence，只按当前 Host 状态更新。')
  const previous = planDraft('Method A is more stable than Method B. evidence:J: Experiment J finds no advantage in a small high-noise subgroup.')
  const retry = compileRetryRequest(req, {
    status:'blocked', reason:'policy-violation', violations:[{ code:'RESEARCH_CONCLUSION_MIRROR_MISMATCH', evidenceQuote:'Method A is more stable than Method B' }],
  }, { sameTurnToolResults:evidenceJ, previousResponse:previous })
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.match(safe, /Experiment J finds no advantage in a small high-noise subgroup\./)
  assert.match(safe, /当前结论仍未定/)
})


test('RC11 composes a validation-next-step repair with an explicit do-not-erase opposing-evidence obligation', () => {
  const req = researchReq('基于当前 Host evidence 做阶段性说明；严格服从当前工作流，不抹掉反向证据，并指出仍需验证什么。')
  req.evidence = [
    { evidenceId:'evidence:B', stance:'oppose', summary:'Experiment B reports no stability advantage and higher tail variance for method A.', source:{ locator:'app://B', title:'B' } },
  ]
  const draft = planDraft('当前结论仍未定，但还没有写出下一步验证。Experiment B reports no stability advantage and higher tail variance for method A.')
  const retry = compileRetryRequest(req, {
    status:'blocked', reason:'policy-violation', violations:[{ code:'RESEARCH_VALIDATION_NEXT_STEP_NOT_VISIBLE', evidenceQuote:'当前结论仍未定' }],
  }, { previousResponse:draft })
  const safe = retry.responseContract.jsonSchema.properties.message.enum[0]
  assert.match(safe, /Experiment B reports no stability advantage and higher tail variance for method A\./)
  assert.match(safe, /独立验证|复现实验|独立证据/)
})
