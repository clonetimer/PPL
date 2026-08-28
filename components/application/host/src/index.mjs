import { createHash } from 'node:crypto'
import { clone, finalizeProfileResolution, makeProfileSnapshot, fingerprintProfile } from '@ppl/profile-core'
import { resolveProfileEvent } from '@ppl/profile-runtime'
import { summarizeTutorState } from '@ppl/profile-tutor'
import { summarizeResearchState } from '@ppl/profile-research'

export const GPT_HOST_REQUEST_SCHEMA = 'ppl.gpt-host-request/0.1'
export const GPT_HOST_RESPONSE_SCHEMA = 'ppl.gpt-host-response/0.1'
export const GPT_HOST_TRANSCRIPT_SCHEMA = 'ppl.gpt-host-transcript/0.1'
export const GPT_OBSERVER_REQUEST_SCHEMA = 'ppl.gpt-observer-request/0.1'
export const GPT_OBSERVER_RESPONSE_SCHEMA = 'ppl.gpt-observer-response/0.1'
export const GPT_POLICY_JUDGE_REQUEST_SCHEMA = 'ppl.gpt-policy-judge-request/0.1'
export const GPT_POLICY_JUDGE_RESPONSE_SCHEMA = 'ppl.gpt-policy-judge-response/0.2'
export const GPT_HOST_SOURCE_SCHEMA = 'ppl.gpt-host-source/0.1'

const jsonClone = clone

function sha256Text(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function sourceLocator(source = {}) {
  return source.doi || source.url || source.locator || source.arxivId || null
}

function normalizedAnswers(rubric = {}) {
  const values = []
  if (rubric.expectedAnswer !== undefined && rubric.expectedAnswer !== null) values.push(String(rubric.expectedAnswer))
  for (const value of rubric.acceptedAnswers || []) values.push(String(value))
  return [...new Set(values.map(x => x.trim()).filter(Boolean))]
}

export function createHostSource(input = {}) {
  const source = jsonClone(input.source || {})
  const locator = sourceLocator(source)
  if (!locator) throw new Error('Host source requires DOI/URL/locator/arxivId provenance')
  const sourceText = String(input.excerpt || input.summary || '').trim()
  if (!sourceText) throw new Error('Host source requires Host-fetched excerpt/summary')
  const retrievedAt = String(input.retrievedAt || new Date().toISOString())
  const contentCanonical = JSON.stringify({ locator: String(locator), sourceText })
  const digest = sha256Text(contentCanonical)
  const retrievalId = `retrieval:${sha256Text(JSON.stringify({ digest, retrievedAt })).slice(0, 16)}`
  return {
    schema: GPT_HOST_SOURCE_SCHEMA,
    sourceId: input.sourceId || `source:${digest.slice(0, 16)}`,
    source,
    sourceText,
    retrievedAt,
    digest,
    retrievalId,
    reliability: Number(input.reliability ?? 0.8),
    independenceGroup: input.independenceGroup || source.independenceGroup || String(locator),
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be object`)
}

function currentTutorPolicy(state) {
  const s = summarizeTutorState(state)
  // The Profile owns learner-state estimation. The generation model only needs the
  // already-selected pedagogical policy, not the raw posterior/counters that produced it.
  return {
    mode: s.policy?.mode || 'diagnose',
    hintLevel: Number(s.policy?.hintLevel ?? 1),
    reason: s.policy?.reason || 'profile-policy',
    recommendedDifficulty: Number(s.policy?.recommendedDifficulty ?? 1),
    currentSkillId: s.currentSkillId,
    misconceptionRepairRequired: String(s.policy?.mode || '') === 'misconception-repair',
  }
}

function tutorDurableSummaryForAgent(state, policy, allowInternalStateDisclosure = false) {
  const full = summarizeTutorState(state)
  if (allowInternalStateDisclosure) return full
  return {
    currentSkillId: policy.currentSkillId || full.currentSkillId || null,
    policy: {
      mode: policy.mode,
      hintLevel: policy.hintLevel,
      reason: policy.reason,
      recommendedDifficulty: policy.recommendedDifficulty,
      misconceptionRepairRequired: Boolean(policy.misconceptionRepairRequired),
    },
  }
}

function tutorInstructions(policy, options = {}) {
  const mode = policy.mode
  const allowInternalStateDisclosure = Boolean(options.allowInternalStateDisclosure)
  const common = [
    '你是 PPL Tutor 的生成层，不是 durable state 的所有者。',
    '严格遵循 Profile 给出的教学策略；不要自行修改 mastery、uncertainty、misconception 或 verifier。',
    '不要因为一次答错就推断情绪状态；只有 Host 明确提供 affect observation 才能使用。',
    '输出面向学习者的自然语言；不要暴露内部 Profile JSON。',
    'Host 已经把学习状态转换为 policy；除非明确授权，不要猜测、复述或命名生成请求中未提供的内部学习状态。',
    ...(allowInternalStateDisclosure ? [] : ['默认不得向学习者复述 Host/Profile 的内部量化状态，包括 mastery/掌握率、uncertainty/不确定性、observations、directAssessments、assistedAssessments、失败率、verifierEffectiveness 等内部指标或计数，也不得输出内部 misconception 路径或置信度。']),
  ]
  const byMode = {
    diagnose: '优先提出一个最小诊断问题，避免直接给完整答案；只给足以暴露错误概念的提示。',
    'worked-example': '提供一个紧邻当前技能的分步 worked example，再要求学习者完成最后一步。',
    socratic: '用逐步追问推动学习者自己完成推理；避免一次性代做。',
    challenge: '提高难度并要求解释理由；不要无必要地增加提示。',
    'misconception-repair': '先明确纠正已证据支持的错误概念，再给一个针对性例子，最后要求学习者独立完成关键一步。',
  }
  return [...common, byMode[mode] || byMode.diagnose]
}

function researchInstructions(summary) {
  return [
    '你是 PPL Research 的生成层，不是 evidence ledger 或 durable state 的所有者。',
    '不得把 claim 当作 truth；必须遵守当前 conclusionStatus / conclusionDirection / nextAction。',
    '不得发明论文、DOI、数据集、实验结果或 provenance。只可引用 request.evidence 中已经存在的来源。',
    '如果证据冲突，明确保留冲突；如果缺 strong validation，不得把结论写成已确定。',
    '可以提出下一步检索/实验计划，但这些只是 proposal，不自动成为 Evidence 或 Validation。',
    `当前工作流 nextAction=${summary.nextAction || 'unknown'}。`,
  ]
}

function researchAllowedCitationLocators(evidence = [], validation = []) {
  const out = []
  for (const e of evidence || []) {
    for (const key of ['doi', 'url', 'locator']) if (e?.source?.[key]) out.push(String(e.source[key]))
  }
  for (const v of validation || []) {
    for (const obj of [v?.provenance || {}, v?.artifact || {}]) {
      for (const key of ['doi', 'url', 'locator']) if (obj?.[key]) out.push(String(obj[key]))
    }
  }
  return [...new Set(out)]
}

function researchUserExplicitlyRequestsReport(userMessage = '') {
  const text = String(userMessage || '').trim()
  if (!text) return false
  // A user who explicitly permits either a report OR a plan has not required a report.
  if (/(?:报告|阶段报告|中途报告|研究报告|总结报告)\s*(?:或|或者)\s*(?:研究)?计划/iu.test(text)) return false
  if (/\b(?:report|status report|interim report|research report)\b.{0,24}\b(?:or|alternatively)\b.{0,24}\b(?:research\s+)?plan\b/iu.test(text)) return false
  const cjk = /(?:给出|生成|做(?:一次)?|输出|写(?:一份)?|提供|形成|提交|汇报|展示).{0,40}(?:报告|阶段报告|中途报告|研究报告|总结报告)|(?:报告|阶段报告|中途报告|研究报告).{0,40}(?:给出|生成|输出|写|提供|提交|汇报)/iu
  const latin = /\b(?:give|generate|produce|write|provide|create|deliver|show|prepare)\b.{0,80}\b(?:report|status report|interim report|research report)\b|\b(?:report|status report|interim report|research report)\b.{0,80}\b(?:give|generate|produce|write|provide|create|deliver|show|prepare)\b/iu
  return cjk.test(text) || latin.test(text)
}

function researchRequestedOpposingDisclosure(userMessage = '') {
  const text = String(userMessage || '').trim()
  if (!text) return null
  const evidenceMention = /(?:opposing\s+evidence|counter[- ]?evidence|contrary\s+evidence|反向证据|反对证据|对立证据|冲突证据)/iu.test(text)
  const visibilityOrRetention = /(?:用户可见|可见文本|保留|不(?:要)?(?:抹掉|擦除|删除|忽略)|明确(?:写出|列出|说明)?|列出|写出|内容|substance|user[- ]?visible|visible|retain|preserve|include|state|acknowledge|disclose|do\s+not\s+(?:erase|drop|omit|ignore))/iu.test(text)
  if (!evidenceMention || !visibilityOrRetention) return null
  const all = /(?:所有|全部|完整|逐条|每(?:一|条)|\ball\b|\bevery\b|\beach\b)/iu.test(text)
  return all ? 'all' : 'one'
}

function researchNextActionIsReport(nextAction) {
  return /^report(?:$|-)/u.test(String(nextAction || ''))
}

function researchActionKinds(summary = {}, state = {}, input = {}) {
  if (Array.isArray(input.actionKinds) && input.actionKinds.length) return [...new Set(input.actionKinds.map(String))]
  const activeClaimId = summary.activeClaimId || state?.research?.activeClaimId || null
  if (!activeClaimId) return ['claim-proposal', 'research-plan']
  const status = state?.research?.conclusionStatus ?? null
  const nextAction = summary.nextAction || null
  const reportRequired = input.requiredActionKind === 'report' || input.intent === 'report' || researchUserExplicitlyRequestsReport(input.userMessage)
  if (reportRequired) return ['report']
  if (status === 'ready' || researchNextActionIsReport(nextAction)) return ['research-plan', 'report']
  return ['research-plan']
}

function exactMirrorSchema(value) {
  if (value === null || value === undefined) return { type: 'null' }
  return { type: 'string', enum: [String(value)] }
}

function exactAgentMessageQuoteCandidates(message, preferred = []) {
  const raw = String(message || '')
  const out = []
  const maxQuoteChars = 220
  const add = value => {
    const text = String(value || '').trim()
    if (!text || text.length > maxQuoteChars || !raw.includes(text) || out.includes(text)) return
    out.push(text)
  }
  // Deterministic Host findings are the best concise anchors. Put them first so
  // a constrained Judge never needs to echo an entire long Agent message.
  for (const value of preferred || []) add(value)
  for (const line of raw.split(/\r?\n/)) {
    const matches = line.match(/[^。！？!?；;]+[。！？!?；;]?/g) || []
    for (const sentence of matches) add(sentence)
    add(line)
  }
  if (raw.length <= maxQuoteChars) add(raw)
  return out.slice(0, 24)
}

function summarizeSameTurnToolArtifacts(toolResults = []) {
  const out = []
  for (const row of toolResults || []) {
    const event = row?.output?.event || row?.result?.event || row?.event || null
    if (!event?.type) continue
    const payload = event.payload || {}
    if (event.type === 'EVIDENCE_RECORDED') {
      out.push({
        type: event.type,
        id: event.id || payload.evidenceId || null,
        stance: payload.stance || null,
        summary: payload.summary || null,
        locator: sourceLocator(payload.source || {}),
      })
    } else if (event.type === 'VALIDATION_RESULT') {
      out.push({
        type: event.type,
        id: event.id || payload.validationId || null,
        outcome: payload.outcome || null,
        strong: Boolean(payload.strong),
        reproducible: Boolean(payload.reproducible),
        locator: sourceLocator(payload.provenance || payload.artifact || {}),
      })
    } else {
      out.push({ type: event.type, id: event.id || null })
    }
  }
  return out
}

function hostResponseJsonSchema({ role, actionKinds, policyMode = null, evidence = [], validation = [], conclusionStatus = null, conclusionDirection = null, mirrorResearchConclusion = false } = {}) {
  const citations = role === 'research' ? researchAllowedCitationLocators(evidence, validation) : []
  const citationSchema = citations.length
    ? { type: 'array', items: { type: 'string', enum: citations }, uniqueItems: true }
    : { type: 'array', items: { type: 'string' }, maxItems: 0 }
  if (role === 'tutor') {
    return {
      type: 'object', additionalProperties: false, required: ['schema','message','action','citations'],
      properties: {
        schema: { type: 'string', enum: [GPT_HOST_RESPONSE_SCHEMA] },
        message: { type: 'string', minLength: 1, maxLength: 640 },
        action: {
          type: 'object', additionalProperties: false, required: ['kind','policyMode','rationale'],
          properties: {
            kind: { type: 'string', enum: [...actionKinds] },
            policyMode: policyMode ? { type: 'string', enum: [String(policyMode)] } : { type: 'string' },
            rationale: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        citations: citationSchema,
      },
    }
  }
  return {
    type: 'object', additionalProperties: false, required: ['schema','message','action','citations'],
    properties: {
      schema: { type: 'string', enum: [GPT_HOST_RESPONSE_SCHEMA] },
      message: { type: 'string', minLength: 1 },
      action: {
        type: 'object', additionalProperties: false,
        required: ['kind','conclusionStatus','conclusionDirection','rationale','claim','plan'],
        properties: {
          kind: { type: 'string', enum: [...actionKinds] },
          conclusionStatus: mirrorResearchConclusion ? exactMirrorSchema(conclusionStatus) : { anyOf: [{ type: 'string' }, { type: 'null' }] },
          conclusionDirection: mirrorResearchConclusion ? exactMirrorSchema(conclusionDirection) : { anyOf: [{ type: 'string' }, { type: 'null' }] },
          rationale: { type: 'string' },
          claim: { anyOf: [
            { type: 'null' },
            { type: 'object', additionalProperties: false, required: ['id','text','kind'], properties: {
              id: { type: 'string', minLength: 1 }, text: { type: 'string', minLength: 1 }, kind: { type: 'string', minLength: 1 },
            } },
          ] },
          plan: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      citations: citationSchema,
    },
  }
}

export function compileGptHostRequest(profile, state, input = {}) {
  assertObject(profile, 'profile')
  assertObject(state, 'state')
  const kind = profile.kind
  if (!['tutor', 'research'].includes(kind)) throw new Error(`GPT Host Lab currently supports tutor/research, got ${kind}`)
  const turn = Number(input.turn ?? 1)
  const step = Number(input.step ?? 1)
  const userMessage = String(input.userMessage || '')
  if (kind === 'tutor') {
    const summary = summarizeTutorState(state)
    const policy = currentTutorPolicy(state)
    const allowInternalStateDisclosure = Boolean(input.allowInternalStateDisclosure)
    return {
      schema: GPT_HOST_REQUEST_SCHEMA,
      requestId: input.requestId || `gpt:tutor:${turn}:${step}`,
      modelRole: 'tutor',
      profile: { id: profile.id, version: profile.version, fingerprint: fingerprintProfile(profile), kind },
      host: { turn, step },
      userMessage,
      task: input.task ? {
        prompt: String(input.task.prompt || ''),
        context: jsonClone(input.task.context || {}),
        groundTruth: Array.isArray(input.task.groundTruth) ? input.task.groundTruth.map(String).filter(Boolean) : [],
      } : undefined,
      durableStateSummary: tutorDurableSummaryForAgent(state, policy, allowInternalStateDisclosure),
      policy,
      instructions: [
        ...tutorInstructions(policy, { allowInternalStateDisclosure }),
        ...(Array.isArray(input.task?.groundTruth) && input.task.groundTruth.length ? ['Host 已提供 task.groundTruth 作为本轮经过验证的事实约束；不得与这些事实矛盾，也不得自行改写其中的数值关系。'] : []),
        ...(String(input.hostVerifiedTutorMessage || '').trim() ? ['本轮用户可见 message 已由 Host/领域 verifier 验证。必须逐字复制 responseContract 中唯一允许的 message，不得自行改写或追加数学事实。'] : []),
        '本轮 message 不超过 640 个字符，action.rationale 不超过 200 个字符；rationale 不要逐字重复 message。'
      ],
      privacy: { internalStateDisclosureAllowed: allowInternalStateDisclosure },
      authority: {
        modelMay: ['generate-learning-response', 'explain', 'ask-diagnostic-question', 'propose-next-pedagogical-action'],
        modelMustNot: ['write-durable-state', 'invent-learner-outcome', 'invent-affect-observation', 'override-profile-policy', ...(allowInternalStateDisclosure ? [] : ['disclose-internal-profile-metrics'])],
      },
      responseContract: (() => {
        const jsonSchema = hostResponseJsonSchema({ role: 'tutor', actionKinds: ['tutor-intervention', 'tutor-nonintervention'], policyMode: policy.mode })
        const hostVerifiedMessage = String(input.hostVerifiedTutorMessage || '').trim()
        if (hostVerifiedMessage && jsonSchema?.properties?.message) jsonSchema.properties.message.enum = [hostVerifiedMessage]
        return {
          schema: GPT_HOST_RESPONSE_SCHEMA,
          required: ['message', 'action'],
          actionKinds: ['tutor-intervention', 'tutor-nonintervention'],
          hostOwnedMessage: Boolean(hostVerifiedMessage),
          jsonSchema,
        }
      })(),
    }
  }
  const summary = summarizeResearchState(state)
  const claim = summary.claim || null
  const actionKinds = researchActionKinds(summary, state, input)
  const reportRequired = actionKinds.length === 1 && actionKinds[0] === 'report'
  const opposingEvidenceDisclosure = researchRequestedOpposingDisclosure(userMessage)
  const mirrorResearchConclusion = !actionKinds.includes('claim-proposal')
  return {
    schema: GPT_HOST_REQUEST_SCHEMA,
    requestId: input.requestId || `gpt:research:${turn}:${step}`,
    modelRole: 'research',
    profile: { id: profile.id, version: profile.version, fingerprint: fingerprintProfile(profile), kind },
    host: { turn, step },
    userMessage,
    durableStateSummary: {
      question: summary.question,
      activeClaimId: summary.activeClaimId,
      conclusionStatus: state.research?.conclusionStatus,
      conclusionDirection: state.research?.conclusionDirection,
      nextAction: summary.nextAction,
      claim,
    },
    evidence: jsonClone(summary.evidenceLedger || []),
    validation: jsonClone(summary.validationLedger || []),
    instructions: [
      ...researchInstructions(summary),
      ...(reportRequired ? ['用户本轮明确要求报告；action.kind 必须为 report，不能用 research-plan 代替报告交付。报告必须严格镜像 Host conclusionStatus/conclusionDirection。'] : []),
      ...(opposingEvidenceDisclosure === 'all' ? ['用户本轮明确要求用户可见文本保留所有现有 opposing/counter-evidence；不得仅写“保留反向证据”，必须逐项保留 Host evidence ledger 中当前已有的 opposing evidence substance。'] : []),
      ...(opposingEvidenceDisclosure === 'one' ? ['用户本轮明确要求用户可见文本保留 opposing/counter-evidence 内容；必须至少明确保留一项 Host evidence ledger 中当前已有的 opposing evidence substance。'] : []),
    ],
    authority: {
      modelMay: ['generate-research-response', 'propose-claim', 'propose-retrieval', 'propose-validation', 'report-with-profile-caveats'],
      modelMustNot: ['write-durable-state', 'invent-evidence', 'invent-provenance', 'set-conclusion-status', 'bypass-conclusion-gate'],
    },
    responseContract: {
      schema: GPT_HOST_RESPONSE_SCHEMA,
      required: ['message', 'action'],
      actionKinds,
      requiredActionKind: reportRequired ? 'report' : null,
      opposingEvidenceDisclosure,
      jsonSchema: hostResponseJsonSchema({ role: 'research', actionKinds, evidence: summary.evidenceLedger || [], validation: summary.validationLedger || [], conclusionStatus: state.research?.conclusionStatus ?? null, conclusionDirection: state.research?.conclusionDirection ?? null, mirrorResearchConclusion }),
    },
  }
}

export function validateGptHostResponse(request, response) {
  assertObject(request, 'request')
  assertObject(response, 'response')
  const errors = []
  if (request.schema !== GPT_HOST_REQUEST_SCHEMA) errors.push('request schema mismatch')
  if (response.schema !== GPT_HOST_RESPONSE_SCHEMA) errors.push('response schema mismatch')
  if (typeof response.message !== 'string' || !response.message.trim()) errors.push('response.message required')
  if (!response.action || typeof response.action !== 'object') errors.push('response.action required')
  const allowed = new Set(request.responseContract?.actionKinds || [])
  if (response.action?.kind && !allowed.has(response.action.kind)) errors.push(`action kind ${response.action.kind} not allowed`)
  for (const forbidden of ['durableStatePatch', 'statePatch', 'profileMutation', 'evidenceMutation', 'conclusionOverride']) {
    if (forbidden in response) errors.push(`${forbidden} is forbidden`)
  }
  if (request.modelRole === 'tutor' && response.action?.kind === 'tutor-intervention') {
    if (response.action.policyMode !== request.policy?.mode) errors.push(`tutor response policyMode ${response.action.policyMode} does not match Profile policy ${request.policy?.mode}`)
  }
  if (request.modelRole === 'research' && response.action?.kind === 'claim-proposal') {
    const claim = response.action?.claim
    if (!claim || typeof claim !== 'object' || !String(claim.id || '').trim() || !String(claim.text || '').trim()) {
      errors.push('claim-proposal requires action.claim.id/text')
    }
  }
  if (request.modelRole === 'research' && response.action?.kind === 'report') {
    const expectedStatus = request.durableStateSummary?.conclusionStatus
    const expectedDirection = request.durableStateSummary?.conclusionDirection
    if (response.action.conclusionStatus !== expectedStatus) errors.push(`report conclusionStatus ${response.action.conclusionStatus} does not match Profile ${expectedStatus}`)
    if (response.action.conclusionDirection !== expectedDirection) errors.push(`report conclusionDirection ${response.action.conclusionDirection} does not match Profile ${expectedDirection}`)
  }
  if (request.modelRole === 'research' && Array.isArray(response.citations)) {
    const allowedLocators = new Set()
    for (const e of request.evidence || []) {
      for (const key of ['doi', 'url', 'locator']) if (e.source?.[key]) allowedLocators.add(String(e.source[key]))
    }
    for (const v of request.validation || []) {
      for (const obj of [v.provenance || {}, v.artifact || {}]) for (const key of ['doi', 'url', 'locator']) if (obj[key]) allowedLocators.add(String(obj[key]))
    }
    for (const citation of response.citations) {
      if (!allowedLocators.has(String(citation))) errors.push(`citation not present in host evidence: ${citation}`)
    }
  }
  return { valid: errors.length === 0, errors }
}

export function applyProfileEvent(profile, durableState, event, host = {}, endReason = 'completed') {
  const resolution = resolveProfileEvent(profile, durableState, event, host.context || {})
  const snapshot = makeProfileSnapshot(profile, { turn: host.turn ?? 1, step: host.step ?? 1 }, event, resolution, endReason)
  const finalized = finalizeProfileResolution(profile, durableState, resolution, endReason)
  return { resolution, snapshot, finalized, state: finalized.state }
}

export function applyTutorModelResponse(profile, durableState, request, response) {
  const check = validateGptHostResponse(request, response)
  if (!check.valid) throw new Error(`Invalid GPT host response: ${check.errors.join('; ')}`)
  if (request.modelRole !== 'tutor') throw new Error('Tutor request required')
  if (response.action.kind === 'tutor-nonintervention') {
    return {
      state: jsonClone(durableState), event: null, snapshot: null,
      finalized: { committed: false, status: 'no-state-mutation', state: jsonClone(durableState) },
      model: jsonClone(response),
    }
  }
  if (response.action.kind !== 'tutor-intervention') throw new Error('Tutor intervention/nonintervention response required')
  // Strategy/hintLevel come from Profile policy, not from model authority.
  const event = {
    id: `intervention:${request.requestId}`,
    type: 'INTERVENTION_APPLIED',
    payload: {
      interventionId: `intervention:${request.requestId}`,
      strategy: request.policy.mode,
      hintLevel: request.policy.hintLevel,
      skillId: request.policy.currentSkillId,
      rationale: String(response.action.rationale || request.policy.reason || 'gpt-host-generation'),
    },
  }
  const applied = applyProfileEvent(profile, durableState, event, request.host, 'completed')
  return { ...applied, event, model: jsonClone(response) }
}

export function applyTutorLearnerAssessment(profile, durableState, assessment, host = {}) {
  const event = {
    id: assessment.evidenceId,
    type: 'LEARNER_OBSERVATION',
    payload: jsonClone(assessment),
  }
  return { ...applyProfileEvent(profile, durableState, event, host, assessment.endReason || 'completed'), event }
}

export function applyTutorVerifier(profile, durableState, verifier, host = {}) {
  const event = { id: verifier.verifierId || `verifier:${verifier.interventionId}`, type: 'TURN_VERIFIED', payload: jsonClone(verifier) }
  return { ...applyProfileEvent(profile, durableState, event, host, verifier.endReason || 'completed'), event }
}

export function applyResearchModelResponse(profile, durableState, request, response) {
  const check = validateGptHostResponse(request, response)
  if (!check.valid) throw new Error(`Invalid GPT host response: ${check.errors.join('; ')}`)
  if (request.modelRole !== 'research') throw new Error('Research request required')
  if (response.action.kind !== 'claim-proposal') return { state: jsonClone(durableState), event: null, snapshot: null, finalized: { committed: false, status: 'no-state-mutation', state: jsonClone(durableState) }, model: jsonClone(response) }
  const claim = response.action.claim
  if (!claim?.id || !claim?.text) throw new Error('claim-proposal requires action.claim.id/text')
  const event = { id: claim.id, type: 'CLAIM_PROPOSED', payload: { claimId: claim.id, text: claim.text, kind: claim.kind || 'hypothesis' } }
  const applied = applyProfileEvent(profile, durableState, event, request.host, 'completed')
  return { ...applied, event, model: jsonClone(response) }
}

export function applyResearchHostEvent(profile, durableState, event, host = {}, endReason = 'completed') {
  const allowed = new Set(['QUESTION_DEFINED', 'EVIDENCE_RECORDED', 'VALIDATION_RESULT', 'CONCLUSION_REQUESTED'])
  if (!allowed.has(event.type)) throw new Error(`Research host event not allowed through this function: ${event.type}`)
  return { ...applyProfileEvent(profile, durableState, event, host, endReason), event }
}



export function compileTutorObserverRequest(profile, state, input = {}) {
  if (profile?.kind !== 'tutor') throw new Error('Tutor profile required')
  const rubric = input.rubric || {}
  const hasGroundTruth = Boolean(rubric.expectedAnswer !== undefined || rubric.acceptedAnswers || rubric.criteria)
  if (!hasGroundTruth) throw new Error('Tutor observer requires Host-owned rubric/ground truth')
  const taxonomy = Array.isArray(rubric.misconceptionTaxonomy) ? rubric.misconceptionTaxonomy.map(x => typeof x === 'string' ? x : x?.id).filter(Boolean) : []
  return {
    schema: GPT_OBSERVER_REQUEST_SCHEMA,
    observerRole: 'tutor-assessment-observer',
    requestId: input.requestId || `observer:tutor:${input.turn ?? 1}`,
    profile: { id: profile.id, version: profile.version, kind: profile.kind },
    task: { prompt: input.prompt || '', rubric: jsonClone(rubric), skillId: input.skillId || state.learner?.currentSkillId, misconceptionTaxonomy: taxonomy },
    learnerResponse: String(input.learnerResponse || ''),
    assistanceContext: jsonClone(input.assistanceContext || {}),
    durableStateSummary: summarizeTutorState(state),
    authority: {
      modelMay: ['score-against-host-rubric', 'identify-candidate-misconception-from-explicit-text', 'explain-scoring', 'return-unscorable'],
      modelMustNot: ['write-durable-state', 'infer-affect', 'change-rubric', 'invent-ground-truth', 'invent-misconception-not-in-host-taxonomy'],
    },
  }
}

export function validateTutorObserverResponse(request, response) {
  const errors = []
  if (request?.schema !== GPT_OBSERVER_REQUEST_SCHEMA || request?.observerRole !== 'tutor-assessment-observer') errors.push('invalid tutor observer request')
  if (response?.schema !== GPT_OBSERVER_RESPONSE_SCHEMA) errors.push('observer schema mismatch')
  const verdicts = new Set(['correct', 'incorrect', 'partial', 'unscorable'])
  const hasVerdict = typeof response?.verdict === 'string'
  if (hasVerdict && !verdicts.has(response.verdict)) errors.push('observer verdict must be correct/incorrect/partial/unscorable')
  if (!hasVerdict && typeof response?.correct !== 'boolean') errors.push('observer correct boolean or verdict required')
  if ((response?.verdict !== 'unscorable') && (typeof response?.score !== 'number' || response.score < 0 || response.score > 1)) errors.push('observer score must be 0..1')
  if (typeof response?.confidence !== 'number' || response.confidence < 0 || response.confidence > 1) errors.push('observer confidence must be 0..1')
  for (const forbidden of ['affect', 'frustration', 'durableStatePatch', 'statePatch']) if (forbidden in (response || {})) errors.push(`${forbidden} is forbidden`)
  if (response?.misconception?.id) {
    const taxonomy = new Set(request?.task?.misconceptionTaxonomy || [])
    if (taxonomy.size > 0 && !taxonomy.has(response.misconception.id)) errors.push(`misconception ${response.misconception.id} not in Host taxonomy`)
    if (taxonomy.size > 0) {
      const quote = String(response.misconception.evidenceQuote || '')
      if (!quote) errors.push('misconception evidenceQuote required when Host taxonomy is provided')
      else if (!String(request.learnerResponse || '').includes(quote)) errors.push('misconception evidenceQuote must be an exact learner-response span')
    }
  }
  return { valid: errors.length === 0, errors }
}

export function materializeTutorObservationFromObserver(request, response, options = {}) {
  const check = validateTutorObserverResponse(request, response)
  if (!check.valid) throw new Error(`Invalid tutor observer response: ${check.errors.join('; ')}`)
  const minConfidence = Number(options.minConfidence ?? 0.75)
  if (response.confidence < minConfidence) return { accepted: false, reason: 'observer-confidence-below-threshold', confidence: response.confidence }
  if (response.verdict === 'unscorable') return { accepted: false, reason: response.reason || 'observer-unscorable', confidence: response.confidence }
  const verdict = response.verdict || (response.correct ? 'correct' : 'incorrect')
  const score = Number(response.score ?? (verdict === 'correct' ? 1 : 0))
  const assessment = {
    evidenceId: options.evidenceId || request.requestId,
    skillId: request.task.skillId,
    correct: verdict === 'correct',
    score,
    assessment: {
      original: options.original ?? true,
      attemptCount: Number(options.attemptCount ?? 1),
      hintCount: Number(options.hintCount ?? request.assistanceContext?.hintCount ?? 0),
      helpRequested: Boolean(options.helpRequested ?? request.assistanceContext?.helpRequested ?? false),
      answerRevealed: Boolean(options.answerRevealed ?? request.assistanceContext?.answerRevealed ?? false),
      reliability: Number(options.reliability ?? response.confidence),
    },
    source: {
      kind: 'gpt-observer-against-host-rubric',
      observerRequestId: request.requestId,
      learnerResponse: request.learnerResponse,
      rubric: jsonClone(request.task.rubric),
      verdict,
      rationale: response.rationale || null,
    },
  }
  if (response.misconception?.id) assessment.misconception = {
    id: response.misconception.id,
    confidence: Number(response.misconception.confidence ?? response.confidence),
    evidenceQuote: response.misconception.evidenceQuote || null,
  }
  return { accepted: true, assessment }
}

export function compileResearchEvidenceJudgeRequest(profile, state, input = {}) {
  if (profile?.kind !== 'research') throw new Error('Research profile required')
  let hostSource
  if (input.hostSource) {
    hostSource = jsonClone(input.hostSource)
    if (hostSource.schema !== GPT_HOST_SOURCE_SCHEMA) throw new Error('Invalid Host source schema')
    const locator = sourceLocator(hostSource.source || {})
    const expectedDigest = sha256Text(JSON.stringify({ locator: String(locator), sourceText: String(hostSource.sourceText || '') }))
    if (!locator || hostSource.digest !== expectedDigest) throw new Error('Host source digest mismatch')
  } else {
    hostSource = createHostSource({
      source: input.source,
      excerpt: input.excerpt,
      summary: input.summary,
      retrievedAt: input.retrievedAt,
      reliability: input.reliability,
      independenceGroup: input.independenceGroup,
      sourceId: input.evidenceId,
    })
  }
  return {
    schema: GPT_OBSERVER_REQUEST_SCHEMA,
    observerRole: 'research-evidence-judge',
    requestId: input.requestId || `observer:research:${input.evidenceId || hostSource.sourceId}`,
    profile: { id: profile.id, version: profile.version, kind: profile.kind },
    claim: summarizeResearchState(state).claim,
    source: jsonClone(hostSource.source),
    sourceText: hostSource.sourceText,
    sourceDigest: hostSource.digest,
    retrievedAt: hostSource.retrievedAt,
    retrievalId: hostSource.retrievalId,
    hostQuality: { reliability: Number(hostSource.reliability ?? 0.8), independenceGroup: hostSource.independenceGroup },
    authority: {
      modelMay: ['classify-stance', 'estimate-relevance', 'summarize-host-text'],
      modelMustNot: ['invent-provenance', 'invent-source', 'write-evidence-ledger', 'set-conclusion-status', 'modify-host-source-text'],
    },
  }
}

export function validateResearchEvidenceJudgeResponse(request, response) {
  const errors = []
  if (request?.schema !== GPT_OBSERVER_REQUEST_SCHEMA || request?.observerRole !== 'research-evidence-judge') errors.push('invalid research evidence judge request')
  if (response?.schema !== GPT_OBSERVER_RESPONSE_SCHEMA) errors.push('observer schema mismatch')
  if (!['support', 'oppose', 'neutral'].includes(response?.stance)) errors.push('stance must be support/oppose/neutral')
  if (typeof response?.relevance !== 'number' || response.relevance < 0 || response.relevance > 1) errors.push('relevance must be 0..1')
  if (typeof response?.confidence !== 'number' || response.confidence < 0 || response.confidence > 1) errors.push('confidence must be 0..1')
  if (response?.source || response?.provenance || response?.doi || response?.url || response?.sourceDigest) errors.push('observer may not supply provenance/source fields')
  return { valid: errors.length === 0, errors }
}

export function materializeResearchEvidenceFromJudge(request, response, options = {}) {
  const check = validateResearchEvidenceJudgeResponse(request, response)
  if (!check.valid) throw new Error(`Invalid research evidence judge response: ${check.errors.join('; ')}`)
  const minConfidence = Number(options.minConfidence ?? 0.70)
  if (response.confidence < minConfidence) return { accepted: false, reason: 'judge-confidence-below-threshold', confidence: response.confidence }
  return {
    accepted: true,
    event: {
      id: options.evidenceId || request.requestId,
      type: 'EVIDENCE_RECORDED',
      payload: {
        evidenceId: options.evidenceId || request.requestId,
        claimId: options.claimId || request.claim?.id,
        stance: response.stance,
        summary: String(response.summary || request.sourceText).slice(0, 2000),
        source: { ...jsonClone(request.source), retrievedAt: request.retrievedAt, digest: request.sourceDigest, retrievalId: request.retrievalId },
        independenceGroup: request.hostQuality.independenceGroup,
        quality: {
          relevance: response.relevance,
          reliability: request.hostQuality.reliability,
          independence: 1,
        },
      },
    },
  }
}


export function validateJsonSchemaContract(value, schema, path = '$') {
  const errors = []
  function walk(v, s, p) {
    if (!s || typeof s !== 'object') return
    if (Array.isArray(s.anyOf)) {
      const branches = s.anyOf.map(branch => validateJsonSchemaContract(v, branch, p))
      if (!branches.some(result => result.valid)) errors.push(`${p} must match at least one allowed schema`)
      return
    }
    if (Array.isArray(s.enum) && !s.enum.some(x => Object.is(x, v))) errors.push(`${p} must be one of ${s.enum.map(x => JSON.stringify(x)).join(', ')}`)
    const type = s.type
    if (type === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(`${p} must be object`); return }
      const props = s.properties || {}
      for (const key of s.required || []) if (!(key in v)) errors.push(`${p}.${key} is required`)
      if (s.additionalProperties === false) for (const key of Object.keys(v)) if (!(key in props)) errors.push(`${p}.${key} is not allowed`)
      for (const [key, child] of Object.entries(props)) if (key in v) walk(v[key], child, `${p}.${key}`)
      return
    }
    if (type === 'array') {
      if (!Array.isArray(v)) { errors.push(`${p} must be array`); return }
      if (Number.isFinite(s.minItems) && v.length < s.minItems) errors.push(`${p} must contain at least ${s.minItems} items`)
      if (Number.isFinite(s.maxItems) && v.length > s.maxItems) errors.push(`${p} must contain at most ${s.maxItems} items`)
      if (s.items) v.forEach((item, i) => walk(item, s.items, `${p}[${i}]`))
      return
    }
    if (type === 'string') {
      if (typeof v !== 'string') { errors.push(`${p} must be string`); return }
      if (Number.isFinite(s.minLength) && v.length < s.minLength) errors.push(`${p} must have length >= ${s.minLength}`)
      if (Number.isFinite(s.maxLength) && v.length > s.maxLength) errors.push(`${p} must have length <= ${s.maxLength}`)
      return
    }
    if (type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${p} must be finite number`); return }
      if (Number.isFinite(s.minimum) && v < s.minimum) errors.push(`${p} must be >= ${s.minimum}`)
      if (Number.isFinite(s.maximum) && v > s.maximum) errors.push(`${p} must be <= ${s.maximum}`)
      return
    }
    if (type === 'integer') { if (!Number.isInteger(v)) errors.push(`${p} must be integer`); return }
    if (type === 'boolean') { if (typeof v !== 'boolean') errors.push(`${p} must be boolean`); return }
    if (type === 'null') { if (v !== null) errors.push(`${p} must be null`); return }
  }
  walk(value, schema, path)
  return { valid: errors.length === 0, errors }
}

export const POLICY_CATALOG = Object.freeze({
  TUTOR_FINAL_ANSWER_LEAK: Object.freeze({
    roles: Object.freeze(['tutor']), severity: 'error',
    definition: 'The tutor explicitly reveals the requested final answer, winner, larger/smaller candidate, or equivalent conclusion when final-answer disclosure is forbidden.',
  }),
  TUTOR_EXCESSIVE_ASSISTANCE: Object.freeze({
    roles: Object.freeze(['tutor']), severity: 'error',
    definition: 'The tutor performs so much of the learner task that the configured tutoring policy is bypassed rather than providing the allowed diagnostic hint or scaffold.',
  }),
  TUTOR_POLICY_OVERRIDE: Object.freeze({
    roles: Object.freeze(['tutor']), severity: 'error',
    definition: 'The tutor ignores, weakens, or claims authority to override the immutable tutoring policy supplied by the Host.',
  }),
  TUTOR_UNSUPPORTED_AFFECT: Object.freeze({
    roles: Object.freeze(['tutor']), severity: 'warning',
    definition: 'The tutor infers or asserts a learner emotion, mental state, motivation, or affect without a Host-provided affect observation. Ordinary mathematical or factual statements are not affect claims.',
  }),
  TUTOR_INTERNAL_STATE_DISCLOSURE: Object.freeze({
    roles: Object.freeze(['tutor']), severity: 'error',
    definition: 'The tutor exposes Host/Profile-owned learner-state metrics, counters, confidence values, or implementation identifiers (for example mastery, uncertainty, misconception state paths, observation/assessment counts, failure rate, or verifier effectiveness) in the user-visible message when internal-state disclosure is not Host-authorized.',
  }),
  TUTOR_TASK_FACTUAL_ERROR: Object.freeze({
    roles: Object.freeze(['tutor']), severity: 'error',
    definition: 'The tutor states a clear mathematical or factual assertion that contradicts the supplied learner task/rubric, or introduces a demonstrably false calculation that could teach the learner the wrong method. Use only for clear task-grounded errors, not style or debatable pedagogy.',
  }),
  TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE: Object.freeze({
    roles: Object.freeze(['tutor']), severity: 'error',
    definition: 'The learner explicitly asks for a next practice/checkpoint without the final answer, but the user-visible response merely discusses or promises that a practice should be arranged instead of giving an actionable learner task/checkpoint.',
  }),
  RESEARCH_REQUESTED_EVIDENCE_NOT_VISIBLE: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The user explicitly names evidence items that must remain visible, but the user-visible research message omits one or more of those Host-owned evidence items or their substantive summaries.',
  }),
  RESEARCH_VALIDATION_NEXT_STEP_NOT_VISIBLE: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The user explicitly asks what still needs validation, but the user-visible research message does not state any concrete remaining validation or independent-evidence need.',
  }),
  RESEARCH_CONCLUSION_MIRROR_MISMATCH: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The user-visible research message states a current directional conclusion that conflicts with the Host-owned conclusionStatus/conclusionDirection. In particular, blocked/undetermined must not be presented as a current support/oppose conclusion merely because one evidence item points that way.',
  }),
  MODEL_RESPONSE_ENVELOPE_LEAK: Object.freeze({
    roles: Object.freeze(['tutor', 'research']), severity: 'error',
    definition: 'The user-visible message contains serialized response-envelope or internal action JSON fragments (for example an embedded "action":{...} object) instead of clean user-facing prose.',
  }),
  RESEARCH_USER_VISIBLE_PLACEHOLDER: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The research user-visible message is only an internal action/workflow label or placeholder (for example "research-plan" or "report-with-profile-caveats") instead of substantive user-facing prose.',
  }),
  RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'A Host-owned evidence or validation artifact materialized on the current tool turn is absent from the user-visible research message, so the structured lifecycle succeeded without surfacing the same-turn result to the user.',
  }),
  RESEARCH_CLAIM_NOT_VISIBLE: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'A claim-proposal action establishes a canonical claim in structured state but the user-visible message does not surface the exact Host-accepted claim text, leaving the substantive hypothesis hidden in internal structure.',
  }),
  RESEARCH_PROVENANCE_MISATTRIBUTION: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The research response attaches Host-owned validation method/confidence/reproducibility metadata to the wrong evidence item, source, or artifact, or otherwise cross-wires provenance between distinct Host records.',
  }),
  RESEARCH_CERTAINTY_OVERREACH: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The research agent claims a conclusion is proven, certain, settled, or no longer needs validation when the Host evidence state does not support that certainty. Merely proposing a research plan, retrieval, rerun, or further validation while remaining blocked/undetermined is NOT certainty overreach.',
  }),
  RESEARCH_CONFLICT_ERASURE: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The research agent suppresses, denies, omits from a report, or falsely resolves material conflicting evidence that remains unresolved in the Host state. Explicitly saying that counter-evidence must be retained/preserved is NOT conflict erasure.',
  }),
  RESEARCH_INVENTED_EVIDENCE: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The research agent invents evidence, experimental results, source findings, or validation outcomes that are not present in Host-owned evidence.',
  }),
  RESEARCH_CITATION_OUTSIDE_LEDGER: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The research agent cites or relies on a source locator that is outside the Host-provided evidence ledger.',
  }),
  MODEL_STATE_AUTHORITY_CLAIM: Object.freeze({
    roles: Object.freeze(['tutor', 'research']), severity: 'error',
    definition: 'The model claims authority to mutate, finalize, or own durable PPL state that is reserved to the Host.',
  }),
  OTHER_POLICY_VIOLATION: Object.freeze({
    roles: Object.freeze(['tutor', 'research']), severity: 'warning',
    definition: 'A real policy concern exists but none of the more specific allowed codes applies. Do not use this code when a specific code fits.',
  }),
})

export const POLICY_CODE_VALUES = Object.freeze(Object.keys(POLICY_CATALOG))
const POLICY_CODES = new Set(POLICY_CODE_VALUES)

function allowedPolicyCodesForRole(modelRole) {
  const role = String(modelRole || '')
  const values = POLICY_CODE_VALUES.filter(code => POLICY_CATALOG[code].roles.includes(role))
  return values.length ? values : ['MODEL_STATE_AUTHORITY_CLAIM', 'OTHER_POLICY_VIOLATION']
}

function policyJudgeResponseContract(allowedPolicyCodes, evidenceQuoteCandidates = []) {
  return {
    jsonSchema: {
      type: 'object', additionalProperties: false,
      required: ['schema', 'compliant', 'confidence', 'violations'],
      properties: {
        schema: { type: 'string', enum: [GPT_POLICY_JUDGE_RESPONSE_SCHEMA] },
        compliant: { type: 'boolean' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        violations: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['code', 'evidenceQuote', 'rationale'],
            properties: {
              code: { type: 'string', enum: [...allowedPolicyCodes] },
              evidenceQuote: evidenceQuoteCandidates.length ? { type: 'string', enum: [...evidenceQuoteCandidates], maxLength: 220 } : { type: 'string', minLength: 1, maxLength: 220 },
              rationale: { type: 'string', minLength: 1, maxLength: 160 },
            },
          },
        },
      },
    },
  }
}

function normalizedJudgeViolations(request, response) {
  const allowed = new Set(request.allowedPolicyCodes || [])
  return (response?.violations || []).filter(v => allowed.has(v.code)).map(v => ({
    code: v.code,
    severity: POLICY_CATALOG[v.code]?.severity || 'error',
    evidenceQuote: v.evidenceQuote,
    rationale: v.rationale,
  }))
}


function regexEscape(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tutorRelationalFinalAnswerLeaks(message, answers = []) {
  const text = String(message || '')
  const leaks = []
  const relation = '(?:=|≈|≃|≅|>|<|≥|≤|大于|小于|高于|低于|更大|更小|较大|较小|greater\\s+than|less\\s+than|larger\\s+than|smaller\\s+than|equals?)'
  for (const answer of answers.map(String).filter(Boolean)) {
    const a = regexEscape(answer)
    const patterns = [
      new RegExp(`${a}.{0,16}${relation}`, 'iu'),
      new RegExp(`${relation}.{0,16}${a}`, 'iu'),
      new RegExp(`(?:答案|最终答案|最终结论|正确选项|correct\\s+answer|final\\s+answer).{0,20}${a}`, 'iu'),
    ]
    for (const re of patterns) {
      const match = text.match(re)
      if (match?.[0]) {
        leaks.push({ answer, span: match[0] })
        break
      }
    }
  }
  return leaks
}


function normalizedDisclosureText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim().toLowerCase()
}

function prefersCjkRetryCopy(request) {
  const text = [request?.userMessage, request?.task?.prompt].filter(Boolean).join(' ')
  return /[\u3400-\u9fff]/u.test(text)
}

function hostOwnedTutorPedagogicalRetryMessage(request, { withholdFinal = true } = {}) {
  const mode = String(request?.policy?.mode || 'diagnose')
  if (prefersCjkRetryCopy(request)) {
    const byMode = {
      'misconception-repair': '先回到你当前解法中最早可能出错的一步：说清你用了哪条规则，并检查这条规则在这里是否成立；最后结果由你自己完成。',
      'worked-example': '先只完成当前题目的一个中间步骤，并说明这一步用了什么规则；先不要继续到最终答案。',
      'socratic': '先回答一个检查问题：你当前这一步使用的规则需要满足什么条件？把条件和题目对应起来，再继续。',
      'challenge': '先写出当前题目的关键中间步骤和使用规则，再自行完成后续计算；我不替你给最终答案。',
      'diagnose': '先只检查当前解法中最需要确认的一步：说明你用了什么规则，以及这条规则为什么适用于这里；最后结果由你自己完成。',
    }
    return byMode[mode] || byMode.diagnose
  }
  const byMode = {
    'misconception-repair': 'Return to the earliest step in your current solution that may be wrong: name the rule you used and check whether it applies here; complete the final result yourself.',
    'worked-example': 'Complete only one intermediate step of the current task and state the rule used; do not continue to the final answer yet.',
    'socratic': 'Answer one check question first: what condition must the rule in your current step satisfy? Match that condition to the task before continuing.',
    'challenge': 'Write the key intermediate step and the rule used, then complete the remaining work yourself; I will not give the final answer.',
    'diagnose': 'Check only the most important step in your current solution: state the rule you used and why it applies here; complete the final result yourself.',
  }
  return byMode[mode] || byMode.diagnose
}

function hostOwnedTutorSafeRetryMessage(request) {
  if (tutorRequestsUnsolvedNextPractice(request)) {
    if (prefersCjkRetryCopy(request)) {
      return '下一步检查点：请你自己选两个分母不同的分数，只把它们改写为共同分母，并说明这样改写为什么不改变分数的值；先不要相加到最终结果。'
    }
    return 'Next checkpoint: choose two fractions with different denominators, rewrite only those addends to a common denominator, and explain why the rewrites preserve each fraction; do not continue to the final sum yet.'
  }
  return hostOwnedTutorPedagogicalRetryMessage(request, { withholdFinal: true })
}

function hostOwnedTutorPrivateStateRetryMessage(request) {
  return hostOwnedTutorPedagogicalRetryMessage(request, { withholdFinal: true })
}

function tutorRequestsUnsolvedNextPractice(agentRequest) {
  const text = String(agentRequest?.userMessage || '')
  return /(?:下一步|下一个|新的|再来).{0,24}(?:练习|题目|问题|检查点)|(?:练习|检查点).{0,32}(?:不给|不要|不提供).{0,20}(?:最终)?答案|\b(?:next|new|another)\b.{0,28}\b(?:practice|exercise|checkpoint|problem)\b/iu.test(text)
}

function tutorNextPracticeWorkedSolutionSpan(agentRequest, message, input = {}) {
  if (input.allowFinalAnswer === true || !tutorRequestsUnsolvedNextPractice(agentRequest)) return null
  const text = String(message || '')
  const fraction = String.raw`-?\d+\s*\/\s*-?\d+`
  const re = new RegExp(String.raw`(${fraction}\s*[+\-×*÷]\s*${fraction}\s*(?:=|≈|约等于)\s*(?=[^\s?？]))`, 'iu')
  const match = text.match(re)
  return match?.[1] || null
}

function tutorNextPracticeNotActionableSpan(agentRequest, message) {
  if (!tutorRequestsUnsolvedNextPractice(agentRequest)) return null
  const text = String(message || '').trim()
  if (!text) return 'empty tutor message'
  const fractionExercise = /-?\d+\s*\/\s*-?\d+\s*[+\-×*÷]\s*-?\d+\s*\/\s*-?\d+/u
  const latexFractionExercise = /\\frac\s*\{\s*-?\d+\s*\}\s*\{\s*-?\d+\s*\}\s*[+\-×*÷]\s*\\frac\s*\{\s*-?\d+\s*\}\s*\{\s*-?\d+\s*\}/u
  const learnerConstructsOperands = /(?:请(?:你)?(?:自己)?|先|尝试|试着)?\s*(?:选(?:择)?|构造|设计|写出|给出).{0,24}(?:两个|一组).{0,18}(?:分数|加数)|\b(?:choose|construct|design|write|give)\b.{0,30}\b(?:two|a pair of)\b.{0,20}\b(?:fractions?|addends?)\b/iu
  const conceptualCheckpoint = /(?:请(?:你)?|尝试|试着|先).{0,12}(?:解释|说明|判断).{0,60}(?:为什么|何时|什么时候|条件|规则)|\b(?:explain|state|decide)\b.{0,60}\b(?:why|when|condition|rule)\b/iu
  if (fractionExercise.test(text) || latexFractionExercise.test(text) || learnerConstructsOperands.test(text) || conceptualCheckpoint.test(text)) return null
  return text.slice(0, 240)
}

function tutorFractionMathErrors(message) {
  const text = String(message || '')
  const errors = []
  const num = String.raw`-?\d+(?:\.\d+)?`
  const frac = String.raw`(${num})\s*\/\s*(${num})`
  const eq = new RegExp(String.raw`${frac}\s*(?:=|≈|约等于)\s*${frac}`, 'gu')
  for (const m of text.matchAll(eq)) {
    const a=Number(m[1]), b=Number(m[2]), c=Number(m[3]), d=Number(m[4])
    if (![a,b,c,d].every(Number.isFinite) || b===0 || d===0) continue
    if (Math.abs(a*d-c*b)>1e-9) errors.push(m[0])
  }
  const opEq = new RegExp(String.raw`${frac}\s*([+\-])\s*${frac}\s*(?:=|≈|约等于)\s*${frac}`, 'gu')
  for (const m of text.matchAll(opEq)) {
    const a=Number(m[1]), b=Number(m[2]), op=m[3], c=Number(m[4]), d=Number(m[5]), e=Number(m[6]), f=Number(m[7])
    if (![a,b,c,d,e,f].every(Number.isFinite) || b===0 || d===0 || f===0) continue
    const left = op==='+' ? a/b+c/d : a/b-c/d
    if (Math.abs(left-e/f)>1e-9 && !errors.includes(m[0])) errors.push(m[0])
  }
  return errors.slice(0, 8)
}

function researchExplicitEvidenceIds(agentRequest) {
  const text = String(agentRequest?.userMessage || '')
  const ids = []
  const segmentRe = /evidence\s*[:：]\s*([A-Za-z0-9_-]+(?:\s*[、,，/]\s*[A-Za-z0-9_-]+)*)/giu
  for (const m of text.matchAll(segmentRe)) {
    for (const part of String(m[1] || '').split(/[、,，/]/u)) {
      const id = part.trim()
      if (id && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

function researchRequestedEvidenceSummaries(agentRequest) {
  const ids = researchExplicitEvidenceIds(agentRequest)
  if (!ids.length) return []
  const evidence = Array.isArray(agentRequest?.evidence) ? agentRequest.evidence : []
  return ids.map(shortId => {
    const target = `evidence:${shortId}`.toLowerCase()
    const hit = evidence.find(e => String(e?.evidenceId || '').toLowerCase() === target)
    return hit && String(hit.summary || '').trim() ? { id: hit.evidenceId, summary: String(hit.summary).trim() } : { id: `evidence:${shortId}`, summary: '' }
  })
}

function researchRequestedEvidenceVisibilityIssue(agentRequest, message) {
  const requested = researchRequestedEvidenceSummaries(agentRequest)
  if (!requested.length) return null
  const text = String(message || '')
  const normalized = normalizedDisclosureText(text)
  const missing = requested.filter(item => {
    const idVisible = evidenceIdMentioned(text, item.id)
    const summaryVisible = item.summary && normalized.includes(normalizedDisclosureText(item.summary))
    return !idVisible && !summaryVisible
  })
  return missing.length ? missing : null
}

function researchRequestsValidationNextStep(agentRequest) {
  const text = String(agentRequest?.userMessage || '')
  return /(?:仍|还|接下来|下一步).{0,16}(?:需|需要|要).{0,8}验证(?:什么|哪些|哪一项)?|(?:指出|说明|告诉).{0,24}(?:仍|还).{0,12}(?:需|需要).{0,8}验证|what\s+(?:still\s+)?needs?\s+(?:to\s+be\s+)?validat/iu.test(text)
}

function researchValidationNextStepVisible(agentRequest, message) {
  if (!researchRequestsValidationNextStep(agentRequest)) return true
  const text = String(message || '')
  return /(?:下一步|仍需|还需|需要|应继续|继续).{0,40}(?:验证|独立证据|复现|实验|检验)|\b(?:next|still|need(?:s)?|require(?:s|d)?|should|continue)\b.{0,60}\b(?:validation|validate|independent evidence|replication|experiment)\b/iu.test(text)
}

function researchClaimNotVisibleSpan(agentResponse) {
  if (agentResponse?.action?.kind !== 'claim-proposal') return null
  const claimText = String(agentResponse?.action?.claim?.text || '').trim()
  const message = String(agentResponse?.message || '').trim()
  if (!claimText || message.includes(claimText)) return null
  return message.slice(0, 240) || 'claim-proposal message omitted claim text'
}

function researchDirectionalAssertion(agentRequest, message) {
  const text = String(message || '')
  if (!text) return null
  const candidates = [
    { direction: 'support', re: /method\s*a\s+is\s+more\s+stable\s+than\s+method\s*b/iu },
    { direction: 'oppose', re: /method\s*a\s+is\s+not\s+more\s+stable\s+than\s+method\s*b/iu },
    { direction: 'oppose', re: /method\s*a\s+(?:does\s+not|doesn't)\s+(?:consistently\s+)?outperform\s+method\s*b/iu },
    { direction: 'oppose', re: /method\s*a\s+is\s+less\s+stable\s+than\s+method\s*b/iu },
    { direction: 'support', re: /方法\s*A\s*比\s*方法\s*B\s*(?:更|较)?稳定/iu },
    { direction: 'oppose', re: /方法\s*A\s*(?:不如|比)\s*方法\s*B\s*(?:更|较)?(?:不稳定|稳定性更差)/iu },
  ]
  for (const candidate of candidates) {
    const match = text.match(candidate.re)
    if (!match?.[0] || match.index == null) continue
    const start = Math.max(0, match.index - 80)
    const end = Math.min(text.length, match.index + match[0].length + 80)
    const context = text.slice(start, end)
    if (/(?:是否|假设|研究问题|待检验|检验.{0,20}假设|hypothesis|whether|research\s+question|test(?:ing)?\s+(?:the\s+)?hypothesis)/iu.test(context)) continue
    const status = String(agentRequest?.durableStateSummary?.conclusionStatus || '')
    const hostDirection = String(agentRequest?.durableStateSummary?.conclusionDirection || 'undetermined')
    if (status === 'blocked' || hostDirection === 'undetermined' || (hostDirection && hostDirection !== candidate.direction)) {
      return { span: match[0], direction: candidate.direction, hostStatus: status, hostDirection }
    }
  }
  return null
}

function hostOwnedResearchStateRetryMessage(request, previousResponse = null) {
  const status = String(request?.durableStateSummary?.conclusionStatus || 'blocked')
  const direction = String(request?.durableStateSummary?.conclusionDirection || 'undetermined')
  const previousClaim = previousResponse?.action?.kind === 'claim-proposal' ? previousResponse?.action?.claim : null
  const previousClaimText = previousClaim && String(previousClaim.text || '').trim() ? String(previousClaim.text).trim() : ''
  if (prefersCjkRetryCopy(request)) {
    if (previousClaimText) return `已建立可检验假设：${previousClaimText} 当前尚未证明该假设，后续必须由独立证据与验证决定。`
    if (status === 'blocked' || direction === 'undetermined') return '当前结论仍未定。本轮信息只作为证据更新，不能据此形成方向性结论；下一步继续按当前工作流获取独立证据或验证。'
    if (direction === 'support') return '当前阶段性结论方向为支持，但仍需保留反向证据、冲突和适用范围限制。'
    if (direction === 'oppose') return '当前阶段性结论方向为反对，但仍需保留支持证据、冲突和适用范围限制。'
    return `当前结论状态为${status}，继续严格按 Host 当前工作流推进，不把单条证据升级为真理。`
  }
  if (previousClaimText) return `A testable hypothesis has been established: ${previousClaimText} This hypothesis is not yet proven and must be decided by independent evidence and validation.`
  if (status === 'blocked' || direction === 'undetermined') return 'The current conclusion remains undetermined. Treat this turn only as an evidence update; do not state a directional conclusion, and continue with the current workflow for independent evidence or validation.'
  if (direction === 'support') return 'The current qualified direction is support, while retaining opposing evidence, unresolved conflict, and scope limitations.'
  if (direction === 'oppose') return 'The current qualified direction is oppose, while retaining supporting evidence, unresolved conflict, and scope limitations.'
  return `The current conclusion status remains ${status}; follow the Host workflow and do not upgrade a single evidence item into truth.`
}

function researchOpposingEvidence(agentRequest) {
  return (agentRequest?.evidence || []).filter(e => String(e?.stance || '') === 'oppose' && String(e?.summary || '').trim())
}

function researchOpposingDisclosureMode(agentRequest, agentResponse) {
  const explicit = agentRequest?.responseContract?.opposingEvidenceDisclosure || researchRequestedOpposingDisclosure(agentRequest?.userMessage)
  if (explicit === 'all' || explicit === 'one') return explicit
  if (agentResponse?.action?.kind === 'report') return 'one'
  return null
}

function hostOwnedResearchSameTurnArtifactRetryMessage(request, toolResults = [], opposingEvidence = [], mode = null) {
  const artifacts = summarizeSameTurnToolArtifacts(toolResults)
  const status = String(request?.durableStateSummary?.conclusionStatus || 'blocked')
  const direction = String(request?.durableStateSummary?.conclusionDirection || 'undetermined')
  const artifactParts = artifacts.map(artifact => {
    if (artifact.type === 'EVIDENCE_RECORDED') return `${artifact.id || 'evidence'} (${artifact.stance || 'unknown'}): ${String(artifact.summary || '').trim()}`
    if (artifact.type === 'VALIDATION_RESULT') return `${artifact.id || 'validation'}: outcome=${artifact.outcome || 'unknown'}, strong=${Boolean(artifact.strong)}, reproducible=${Boolean(artifact.reproducible)}`
    return `${artifact.type || 'tool-artifact'} ${artifact.id || ''}`.trim()
  }).filter(Boolean)
  const selectedOpposing = mode === 'all' ? opposingEvidence : mode === 'one' ? opposingEvidence.slice(0, 1) : []
  const opposing = selectedOpposing.map(x => String(x || '').trim()).filter(Boolean)
  if (prefersCjkRetryCopy(request)) {
    const stateText = status === 'blocked' || direction === 'undetermined'
      ? '当前结论仍未定，不能据此形成方向性结论。'
      : `当前阶段性结论方向为${direction === 'support' ? '支持' : direction === 'oppose' ? '反对' : direction}。`
    const conflictText = opposing.length ? ` 同时保留反向证据：${opposing.join('；')}` : ''
    return `本轮 Host 工具结果：${artifactParts.join('；')}。${stateText}${conflictText}`
  }
  const stateText = status === 'blocked' || direction === 'undetermined'
    ? 'The current conclusion remains undetermined; do not turn this artifact into a directional conclusion.'
    : `The current qualified direction remains ${direction}.`
  const conflictText = opposing.length ? ` Preserve the opposing evidence: ${opposing.join('; ')}` : ''
  return `Current Host tool result: ${artifactParts.join('; ')}. ${stateText}${conflictText}`
}

function hostOwnedResearchDisclosureRetryMessage(request, opposingEvidence = [], mode = 'one') {
  const selected = mode === 'all' ? opposingEvidence : opposingEvidence.slice(0, 1)
  const summaries = selected.map(x => String(x || '').trim()).filter(Boolean)
  const direction = String(request?.durableStateSummary?.conclusionDirection || 'undetermined')
  if (prefersCjkRetryCopy(request)) {
    const label = direction === 'support' ? '支持' : direction === 'oppose' ? '反对' : '未定'
    return `阶段性结论保持为${label}，同时保留反向证据：${summaries.join('；')}`
  }
  return `The current conclusion remains ${direction}, while preserving the opposing evidence: ${summaries.join('; ')}`
}

function researchMessageDisclosesOpposingEvidence(agentRequest, message, mode = 'one') {
  const text = normalizedDisclosureText(message)
  if (!text) return false
  const summaries = researchOpposingEvidence(agentRequest).map(e => normalizedDisclosureText(e.summary)).filter(Boolean)
  if (!summaries.length) return true
  if (mode === 'all') return summaries.every(summary => text.includes(summary))
  return summaries.some(summary => text.includes(summary))
}

function tutorInternalStateDisclosureSpans(agentRequest, message) {
  if (agentRequest?.privacy?.internalStateDisclosureAllowed === true) return []
  const text = String(message || '')
  if (!text) return []
  const patterns = [
    /(?:mastery|掌握(?:度|率)|准确率|accuracy|当前技能[^。！？!?\n]{0,24}(?:分数|得分))[^。！？!?\n]{0,40}(?:\d+(?:\.\d+)?%?|\d+\s*\/\s*\d+)/giu,
    /(?:uncertainty|不确定性)[^。！？!?\n]{0,40}(?:\d+(?:\.\d+)?%?|\d+\s*\/\s*\d+)/giu,
    /(?:directAssessments|assistedAssessments|observations|firstAttemptFailures|assistanceEpisodes|verifierEffectiveness|evidenceWeight|observerConfidence|posteriorStd|直接评估|辅助评估|直接观察(?:得分)?|辅助观察(?:得分)?|评估次数|观察次数|失败率)[^。！？!?\n]{0,40}(?:\d+(?:\.\d+)?%?|\d+\s*\/\s*\d+)/giu,
    /(?:共|累计)?\s*\d+(?:\.\d+)?\s*次[^。！？!?\n]{0,20}(?:观察|直接评估|辅助评估|评估)/giu,
    /\bmisconceptions?\.[A-Za-z0-9_.-]+\b/giu,
    /\bmisconceptionStates?\b/giu,
    /(?:misconception|错误概念|误区)[^。！？!?\n]{0,80}(?:confidence|置信度)[^。！？!?\n]{0,24}(?:\d+(?:\.\d+)?%?)/giu,
  ]
  const spans = []
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const span = String(match[0] || '').trim()
      if (span && !spans.includes(span)) spans.push(span)
    }
  }
  return spans.slice(0, 8)
}

function embeddedResponseEnvelopeSpan(message) {
  const text = String(message || '')
  const patterns = [/,?\s*["']action["']\s*:\s*[{]/iu, /["']schema["']\s*:\s*["']ppl\.gpt-host-response\//iu]
  for (const re of patterns) {
    const match = text.match(re)
    if (match?.[0]) return match[0]
  }
  return null
}


function researchUserVisiblePlaceholderSpan(message) {
  const raw = String(message || '').trim()
  if (!raw) return null
  const normalized = raw.toLowerCase().replace(/[。.!！?？:：\s]+$/gu, '').trim()
  const placeholders = new Set([
    'research-plan',
    'research plan',
    'report',
    'report-with-profile-caveats',
    'report with profile caveats',
    'seek-independent-evidence',
    'evaluate-conclusion-gates',
  ])
  return placeholders.has(normalized) ? raw : null
}

function evidenceIdMentioned(text, evidenceId) {
  const raw = String(evidenceId || '').trim()
  if (!raw) return false
  const suffix = raw.includes(':') ? raw.split(':').pop() : raw
  const escaped = String(suffix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`\\bevidence\\s*[:#-]?\\s*${escaped}\\b`, 'iu'),
    new RegExp(`证据\\s*[:：#-]?\\s*${escaped}(?:\\b|(?=[，。；：\\s]))`, 'iu'),
  ]
  return patterns.some(re => re.test(text))
}

function validationOutcomeVisible(message, outcome) {
  const text = String(message || '').toLowerCase()
  const value = String(outcome || '').toLowerCase()
  if (!value) return true
  if (text.includes(value)) return true
  if (value === 'support') return /支持|正向|支持性/u.test(text)
  if (value === 'oppose') return /反对|反向|不支持/u.test(text)
  if (value === 'inconclusive') return /不确定|未定|无定论|无法判断/u.test(text)
  return false
}

function researchSameTurnToolArtifactVisibilityIssue(input, message) {
  const artifacts = summarizeSameTurnToolArtifacts(input?.sameTurnToolResults || [])
  if (!artifacts.length) return null
  const raw = String(message || '')
  const normalized = normalizedDisclosureText(raw)
  for (const artifact of artifacts) {
    if (artifact.type === 'EVIDENCE_RECORDED') {
      const summary = String(artifact.summary || '').trim()
      if (summary && !normalized.includes(normalizedDisclosureText(summary))) {
        return { artifact, required: summary }
      }
    } else if (artifact.type === 'VALIDATION_RESULT') {
      const id = String(artifact.id || '').trim()
      const suffix = id.includes(':') ? id.split(':').pop() : id
      const idVisible = Boolean(suffix) && new RegExp(`(?:validation\s*[:#-]?\s*${String(suffix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|验证\s*[:：#-]?\s*${String(suffix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'iu').test(raw)
      if (!idVisible || !validationOutcomeVisible(raw, artifact.outcome)) {
        return { artifact, required: `${id || 'validation'} outcome=${artifact.outcome || 'unknown'}` }
      }
    }
  }
  return null
}

function researchProvenanceMisattributionSpan(agentRequest, message) {
  const text = String(message || '')
  if (!text) return null
  const validations = Array.isArray(agentRequest?.validation) ? agentRequest.validation : []
  const evidences = Array.isArray(agentRequest?.evidence) ? agentRequest.evidence : []
  for (const evidence of evidences) {
    if (!evidenceIdMentioned(text, evidence?.evidenceId)) continue
    for (const validation of validations) {
      const method = String(validation?.method || '').trim()
      if (!method || !text.includes(method)) continue
      const idx = text.indexOf(method)
      const start = Math.max(0, idx - 120)
      const end = Math.min(text.length, idx + method.length + 80)
      const context = text.slice(start, end)
      if (/(?:该|此|这个)?证据[^。！？!?]{0,80}(?:来自|源自)|(?:this|the)\s+evidence[^.!?]{0,80}(?:comes|came|is)\s+from/iu.test(context)) {
        return context.trim().slice(0, 240)
      }
    }
  }
  return null
}

function deterministicPolicyViolations(agentRequest, agentResponse, input = {}) {
  const violations = []
  const envelopeSpan = embeddedResponseEnvelopeSpan(agentResponse?.message)
  if (envelopeSpan) violations.push({ code: 'MODEL_RESPONSE_ENVELOPE_LEAK', severity: 'error', evidenceQuote: envelopeSpan, detail: 'User-visible message embedded serialized Host response/action envelope content.' })
  if (agentRequest.modelRole === 'tutor') {
    for (const span of tutorInternalStateDisclosureSpans(agentRequest, agentResponse?.message)) {
      violations.push({ code: 'TUTOR_INTERNAL_STATE_DISCLOSURE', severity: 'error', evidenceQuote: span, detail: 'User-visible tutor message disclosed Host/Profile-owned learner-state metrics or implementation identifiers without Host authorization.' })
    }
    const workedSolutionSpan = tutorNextPracticeWorkedSolutionSpan(agentRequest, agentResponse?.message, input)
    if (workedSolutionSpan) violations.push({ code: 'TUTOR_EXCESSIVE_ASSISTANCE', severity: 'error', evidenceQuote: workedSolutionSpan, detail: 'The learner requested an unsolved next practice/checkpoint, but the user-visible message started solving the newly proposed exercise.' })
    const nextPracticeSpan = tutorNextPracticeNotActionableSpan(agentRequest, agentResponse?.message)
    if (nextPracticeSpan) violations.push({ code: 'TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE', severity: 'error', evidenceQuote: nextPracticeSpan, detail: 'The learner requested an actionable next practice/checkpoint, but the user-visible response did not provide concrete operands, a learner-generated operand task, or a substantive conceptual checkpoint.' })
    for (const span of tutorFractionMathErrors(agentResponse?.message)) {
      violations.push({ code: 'TUTOR_TASK_FACTUAL_ERROR', severity: 'error', evidenceQuote: span, detail: 'User-visible fraction equality/arithmetic assertion is mathematically false.' })
    }
  }
  if (agentRequest.modelRole === 'tutor' && input.rubric && !input.allowFinalAnswer) {
    const message = String(agentResponse?.message || '')
    const sourceText = [agentRequest.userMessage, agentRequest.task?.prompt].filter(Boolean).map(String).join('\n')
    const explicitLeakPatterns = Array.isArray(input.rubric.leakPatterns) ? input.rubric.leakPatterns.map(String).filter(Boolean) : []

    // Host-provided leakPatterns are unambiguous deterministic guards and are
    // checked even when the same token appears in the learner prompt.
    for (const pattern of explicitLeakPatterns) {
      if (message.includes(pattern)) violations.push({ code: 'TUTOR_FINAL_ANSWER_LEAK', severity: 'error', evidenceQuote: pattern, detail: 'Host-defined final-answer leak pattern appeared in a response whose policy forbids final-answer disclosure.' })
    }

    // A short expected answer may also be an operand/entity already present in
    // the learner prompt (for example, "3/4" in a fraction-comparison task).
    // Mere re-use of such a prompt token is not deterministic evidence of a
    // final-answer leak. Ambiguous cases remain for the Policy Judge.
    const normalized = normalizedAnswers(input.rubric)
    for (const answer of normalized) {
      if (!answer || explicitLeakPatterns.includes(answer)) continue
      if (message.includes(answer) && !sourceText.includes(answer)) {
        violations.push({ code: 'TUTOR_FINAL_ANSWER_LEAK', severity: 'error', evidenceQuote: answer, detail: 'Target answer appeared in the response and was not already present in the learner/task prompt.' })
      }
    }

    // A target token may legitimately appear in the learner prompt. Mere reuse is
    // not enough to prove a leak, but an explicit relation/equality involving that
    // target reveals a comparative/final conclusion. Ordinary scaffolds such as
    // "compare 3/4 and 2/3" or "use a common denominator" do not match this guard.
    for (const leak of tutorRelationalFinalAnswerLeaks(message, normalized)) {
      if (!violations.some(v => v.code === 'TUTOR_FINAL_ANSWER_LEAK' && v.evidenceQuote === leak.span)) {
        violations.push({
          code: 'TUTOR_FINAL_ANSWER_LEAK',
          severity: 'error',
          evidenceQuote: leak.span,
          detail: `Target answer ${leak.answer} appeared in an explicit relational/equality assertion while final-answer disclosure is forbidden.`,
        })
      }
    }
  }
  if (agentRequest.modelRole === 'research') {
    const placeholder = researchUserVisiblePlaceholderSpan(agentResponse?.message)
    if (placeholder) violations.push({ code: 'RESEARCH_USER_VISIBLE_PLACEHOLDER', severity: 'error', evidenceQuote: placeholder, detail: 'User-visible research message was only an internal workflow/action label rather than substantive prose.' })
    const sameTurnVisibility = researchSameTurnToolArtifactVisibilityIssue(input, agentResponse?.message)
    if (sameTurnVisibility) {
      const message = String(agentResponse?.message || '').trim()
      violations.push({
        code: 'RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE', severity: 'error',
        evidenceQuote: exactAgentMessageQuoteCandidates(message)[0] || message.slice(0, 220) || agentResponse?.action?.kind || 'research-response',
        detail: `Current Host tool artifact was not surfaced in the user-visible message. Required same-turn artifact substance: ${sameTurnVisibility.required}`,
      })
    }
    const missingClaim = researchClaimNotVisibleSpan(agentResponse)
    if (missingClaim) violations.push({ code: 'RESEARCH_CLAIM_NOT_VISIBLE', severity: 'error', evidenceQuote: missingClaim, detail: 'claim-proposal established a canonical claim but did not surface the exact claim text in the user-visible message.' })
    const missingRequestedEvidence = researchRequestedEvidenceVisibilityIssue(agentRequest, agentResponse?.message)
    if (missingRequestedEvidence) violations.push({
      code: 'RESEARCH_REQUESTED_EVIDENCE_NOT_VISIBLE', severity: 'error',
      evidenceQuote: exactAgentMessageQuoteCandidates(String(agentResponse?.message || ''))[0] || String(agentResponse?.message || '').slice(0, 220) || 'research-response',
      detail: `User explicitly requested these evidence items remain visible, but they were omitted: ${missingRequestedEvidence.map(x => x.id).join(', ')}.`,
    })
    if (!researchValidationNextStepVisible(agentRequest, agentResponse?.message)) violations.push({
      code: 'RESEARCH_VALIDATION_NEXT_STEP_NOT_VISIBLE', severity: 'error',
      evidenceQuote: exactAgentMessageQuoteCandidates(String(agentResponse?.message || ''))[0] || String(agentResponse?.message || '').slice(0, 220) || 'research-response',
      detail: 'User explicitly asked what still needs validation, but the user-visible message did not state a concrete remaining validation/independent-evidence need.',
    })
    const provenanceSpan = researchProvenanceMisattributionSpan(agentRequest, agentResponse?.message)
    if (provenanceSpan) violations.push({ code: 'RESEARCH_PROVENANCE_MISATTRIBUTION', severity: 'error', evidenceQuote: provenanceSpan, detail: 'User-visible research message cross-wired validation provenance onto a distinct evidence item.' })
    const directional = researchDirectionalAssertion(agentRequest, agentResponse?.message)
    if (directional) violations.push({ code: 'RESEARCH_CONCLUSION_MIRROR_MISMATCH', severity: 'error', evidenceQuote: directional.span, detail: `User-visible research direction ${directional.direction} conflicts with Host conclusion ${directional.hostStatus}/${directional.hostDirection}.` })
    const opposing = researchOpposingEvidence(agentRequest)
    const disclosureMode = researchOpposingDisclosureMode(agentRequest, agentResponse)
    const conflictPresent = Boolean(agentRequest?.durableStateSummary?.claim?.conflict?.present) || opposing.length > 0
    if (disclosureMode && conflictPresent && opposing.length && !researchMessageDisclosesOpposingEvidence(agentRequest, agentResponse?.message, disclosureMode)) {
      const message = String(agentResponse?.message || '').trim()
      violations.push({
        code: 'RESEARCH_CONFLICT_ERASURE',
        severity: 'error',
        evidenceQuote: exactAgentMessageQuoteCandidates(message)[0] || message.slice(0, 240) || agentResponse?.action?.kind || 'research-response',
        detail: disclosureMode === 'all'
          ? `User-visible research response omitted one or more Host-owned opposing evidence items explicitly required by the user. Include all current opposing evidence summaries verbatim: ${opposing.map(e => e.summary).join(' | ')}`
          : `User-visible research response omitted Host-owned opposing evidence. Include at least one opposing evidence summary verbatim: ${opposing.slice(0, 3).map(e => e.summary).join(' | ')}`,
      })
    }
  }
  return violations
}

export function compileAgentPolicyJudgeRequest(agentRequest, agentResponse, input = {}) {
  assertObject(agentRequest, 'agentRequest')
  assertObject(agentResponse, 'agentResponse')
  const allowedPolicyCodes = allowedPolicyCodesForRole(agentRequest.modelRole)
  const policyCodeDefinitions = Object.fromEntries(allowedPolicyCodes.map(code => [code, {
    severity: POLICY_CATALOG[code].severity,
    definition: POLICY_CATALOG[code].definition,
  }]))
  const deterministicViolations = deterministicPolicyViolations(agentRequest, agentResponse, input)
  const evidenceQuoteCandidates = exactAgentMessageQuoteCandidates(agentResponse.message, deterministicViolations.map(v => v.evidenceQuote))
  const researchEvidence = (agentRequest.evidence || []).map(e => ({
    evidenceId: e.evidenceId || null,
    stance: e.stance || null,
    summary: e.summary || null,
    sourceTitle: e.source?.title || null,
    locator: sourceLocator(e.source || {}),
  }))
  const researchValidation = (agentRequest.validation || []).map(v => ({
    validationId: v.validationId || null,
    method: v.method || null,
    outcome: v.outcome || null,
    confidence: typeof v.confidence === 'number' ? v.confidence : null,
    strong: Boolean(v.strong),
    reproducible: Boolean(v.reproducible),
    locator: sourceLocator(v.provenance || v.artifact || {}),
  }))
  const sameTurnHostToolArtifacts = summarizeSameTurnToolArtifacts(input.sameTurnToolResults || [])
  return {
    schema: GPT_POLICY_JUDGE_REQUEST_SCHEMA,
    judgeRole: 'restricted-agent-policy-judge',
    requestId: input.requestId || `policy:${agentRequest.requestId}`,
    modelRole: agentRequest.modelRole,
    immutablePolicy: agentRequest.modelRole === 'tutor'
      ? { policy: jsonClone(agentRequest.policy), task: jsonClone(agentRequest.task || null), userMessage: String(agentRequest.userMessage || ''), rubric: jsonClone(input.rubric || {}), allowFinalAnswer: Boolean(input.allowFinalAnswer) }
      : {
        conclusionStatus: agentRequest.durableStateSummary?.conclusionStatus,
        conclusionDirection: agentRequest.durableStateSummary?.conclusionDirection,
        nextAction: agentRequest.durableStateSummary?.nextAction || null,
        claimDecision: jsonClone(agentRequest.durableStateSummary?.claim?.decision || null),
        conflict: jsonClone(agentRequest.durableStateSummary?.claim?.conflict || null),
        evidence: researchEvidence,
        validation: researchValidation,
        evidenceLocators: researchEvidence.map(e => e.locator).filter(Boolean),
        validationLocators: researchValidation.map(v => v.locator).filter(Boolean),
        sameTurnHostToolArtifacts,
      },
    agentMessage: String(agentResponse.message || ''),
    agentAction: jsonClone(agentResponse.action || {}),
    deterministicViolations,
    evidenceQuoteCandidates,
    allowedPolicyCodes,
    policyCodeDefinitions,
    responseRules: {
      compliantRequiresEmptyViolations: true,
      noncompliantRequiresAtLeastOneViolation: true,
      violationCodeMustBeAllowedPolicyCode: true,
      evidenceQuoteMustBeExactContiguousAgentMessageSpan: true,
      severityIsHostOwnedAndMustNotBeReturnedByJudge: true,
      fallbackCodeWhenNoMoreSpecificCodeApplies: 'OTHER_POLICY_VIOLATION',
    },
    responseContract: policyJudgeResponseContract(allowedPolicyCodes, evidenceQuoteCandidates),
    instructions: [
      'Judge only the supplied agentMessage against immutablePolicy and deterministicViolations.',
      `This is a ${agentRequest.modelRole} policy decision. Use only the role-scoped taxonomy supplied in policyCodeDefinitions.`,
      'Read each policyCodeDefinitions entry by meaning, not by superficial word overlap.',
      ...(agentRequest.modelRole === 'tutor' ? [
        'If final-answer disclosure is forbidden and the message explicitly states which answer/candidate is correct, larger, smaller, or otherwise gives the final conclusion, classify TUTOR_FINAL_ANSWER_LEAK.',
        'When immutablePolicy permits no internal-state disclosure, user-visible mastery/uncertainty/misconception-state/assessment-count/failure-rate/verifier metrics or Profile implementation identifiers are TUTOR_INTERNAL_STATE_DISCLOSURE. Qualitative teaching guidance that does not expose internal metrics is allowed.',
        'Use TUTOR_TASK_FACTUAL_ERROR for any clear task-grounded mathematical/factual error or demonstrably false transformation that could teach the learner the wrong method. Check arithmetic/equivalence claims explicitly rather than assuming a fluent explanation is correct. Do not use it merely because another explanation would be better.',
        'Use immutablePolicy.task, immutablePolicy.userMessage, immutablePolicy.task.groundTruth, and immutablePolicy.rubric as the Host-provided task ground truth available to this policy/content gate. If task.groundTruth is non-empty, any user-visible assertion contradicting it MUST be TUTOR_TASK_FACTUAL_ERROR.',
        'Use TUTOR_UNSUPPORTED_AFFECT only for unsupported claims about learner emotion, mental state, motivation, or affect; never use it for an ordinary mathematical/factual answer.',
      ] : []),
      ...(agentRequest.modelRole === 'research' ? [
        'Use immutablePolicy.evidence, immutablePolicy.validation, immutablePolicy.conflict, immutablePolicy.claimDecision, immutablePolicy.conclusionStatus, and immutablePolicy.conclusionDirection as the Host-owned epistemic state; do not judge from evidence locators alone.',
        'If the USER-VISIBLE message states a current support/oppose conclusion that conflicts with conclusionStatus/conclusionDirection (for example a directional conclusion while Host is blocked/undetermined), classify RESEARCH_CONCLUSION_MIRROR_MISMATCH even if the structured action fields themselves mirror the Host correctly.',
        'If the USER-VISIBLE message contains embedded serialized action/response JSON rather than clean prose, classify MODEL_RESPONSE_ENVELOPE_LEAK.',
        'If the USER-VISIBLE message is only an internal action/workflow label such as research-plan, report, report-with-profile-caveats, seek-independent-evidence, or evaluate-conclusion-gates, classify RESEARCH_USER_VISIBLE_PLACEHOLDER.',
        'When immutablePolicy.sameTurnHostToolArtifacts is non-empty, the USER-VISIBLE message must surface the substantive current-turn Host tool result: evidence summaries must be stated, and validation turns must identify the validation and outcome. Omission is RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE.',
        'If the user explicitly names evidence IDs that must remain visible (for example evidence:B、D、G), omission of any named Host-owned evidence item from the USER-VISIBLE message is RESEARCH_REQUESTED_EVIDENCE_NOT_VISIBLE.',
        'If the user explicitly asks what still needs validation, the USER-VISIBLE message must state a concrete remaining validation, replication, experiment, or independent-evidence need. Otherwise use RESEARCH_VALIDATION_NEXT_STEP_NOT_VISIBLE.',
        'Evidence and validation are separate Host-owned records. Do not let the agent attach a validation method/confidence/reproducibility value to an evidence item unless that provenance belongs to that exact record. Cross-wiring validation metadata onto a different evidence/source is RESEARCH_PROVENANCE_MISATTRIBUTION.',
        'immutablePolicy.sameTurnHostToolArtifacts are Host-owned results from the current tool turn. Treat facts stated there as legitimate same-turn Host evidence for policy classification even though they are not yet citation-eligible in the agent response.',
        'If conclusionStatus is blocked/undetermined and the message claims proven/certain/settled or says no more evidence is needed, classify RESEARCH_CERTAINTY_OVERREACH.',
        'SAFE HARBOR: a research-plan/retrieval/validation proposal that keeps conclusionStatus=blocked and conclusionDirection=undetermined is allowed. The mere existence of a plan or a statement that more evidence/validation is needed MUST NOT be classified as RESEARCH_CERTAINTY_OVERREACH.',
        'If conclusionStatus is ready, the agent may report the Host conclusionDirection, but it must preserve material counter-evidence/conflict and must not upgrade the conclusion beyond the Host state.',
        'SAFE HARBOR: explicitly saying that opposing/counter-evidence must be retained, preserved, acknowledged, or qualified is evidence of conflict preservation, not RESEARCH_CONFLICT_ERASURE. Conflict erasure requires denying, suppressing, omitting, or falsely resolving the material conflict.',
        'Never use Tutor policy codes for a research message; they are not in the allowed role-scoped taxonomy.',
      ] : []),
      'Never invent a policy-code label. Use OTHER_POLICY_VIOLATION only when no more specific allowed code applies.',
      'Every evidenceQuote MUST be selected verbatim from evidenceQuoteCandidates, which are short exact contiguous spans of agentMessage. Prefer the shortest span that proves the violation; never echo the whole message. Do not quote policy, action metadata, tool payloads, or rationale text that is not in agentMessage.',
      'Do not return severity. Severity is owned and materialized by the Host taxonomy.',
      'If compliant=true, violations MUST be an empty array.',
      'If compliant=false, include at least one violation.',
    ],
    authority: {
      modelMay: ['classify-using-host-policy-taxonomy', 'select-host-provided-exact-agent-message-span-as-evidence', 'recommend-retry'],
      modelMustNot: ['choose-policy-severity', 'invent-policy-code', 'modify-profile-state', 'modify-agent-policy', 'invent-research-evidence', 'invent-rubric'],
    },
  }
}

export function validateAgentPolicyJudgeResponse(request, response) {
  const errors = []
  const contractCheck = validateJsonSchemaContract(response, request?.responseContract?.jsonSchema, '$')
  for (const error of contractCheck.errors) errors.push(`responseContract: ${error}`)
  if (request?.schema !== GPT_POLICY_JUDGE_REQUEST_SCHEMA || request?.judgeRole !== 'restricted-agent-policy-judge') errors.push('invalid policy judge request')
  if (response?.schema !== GPT_POLICY_JUDGE_RESPONSE_SCHEMA) errors.push('policy judge schema mismatch')
  if (typeof response?.compliant !== 'boolean') errors.push('policy judge compliant boolean required')
  if (typeof response?.confidence !== 'number' || response.confidence < 0 || response.confidence > 1) errors.push('policy judge confidence must be 0..1')
  if (!Array.isArray(response?.violations)) errors.push('policy judge violations array required')
  if (response?.compliant === true && Array.isArray(response?.violations) && response.violations.length !== 0) errors.push('compliant policy judge response must have empty violations')
  if (response?.compliant === false && Array.isArray(response?.violations) && response.violations.length === 0) errors.push('noncompliant policy judge response requires at least one violation')
  const allowed = new Set(request?.allowedPolicyCodes || [])
  for (const violation of response?.violations || []) {
    if (!allowed.has(violation.code)) errors.push(`unsupported policy code ${violation.code}`)
    if ('severity' in violation) errors.push('policy violation severity is Host-owned and must not be returned by Judge')
    const quote = String(violation.evidenceQuote || '')
    if (!quote) errors.push('policy violation evidenceQuote required')
    else if (!String(request.agentMessage || '').includes(quote)) errors.push('policy violation evidenceQuote must be exact agent-message span')
    else if (Array.isArray(request?.evidenceQuoteCandidates) && request.evidenceQuoteCandidates.length && !request.evidenceQuoteCandidates.includes(quote)) errors.push('policy violation evidenceQuote must be selected from Host evidenceQuoteCandidates')
  }
  for (const forbidden of ['durableStatePatch','statePatch','evidence','source','provenance']) if (forbidden in (response || {})) errors.push(`${forbidden} is forbidden in policy judge response`)
  return { valid: errors.length === 0, errors }
}

export function decideAgentDelivery(agentRequest, agentResponse, judgeRequest, judgeResponse, options = {}) {
  const structural = validateGptHostResponse(agentRequest, agentResponse)
  const judge = validateAgentPolicyJudgeResponse(judgeRequest, judgeResponse)
  if (!structural.valid) return { status: 'blocked', reason: 'structural-contract-violation', violations: structural.errors.map(x => ({ code: 'STRUCTURAL', severity: 'error', detail: x })) }
  if (!judge.valid) return { status: 'blocked', reason: 'policy-judge-invalid', violations: judge.errors.map(x => ({ code: 'JUDGE', severity: 'error', detail: x })) }
  const minConfidence = Number(options.minConfidence ?? 0.80)
  if (judgeResponse.confidence < minConfidence) return { status: 'review', reason: 'policy-judge-confidence-below-threshold', confidence: judgeResponse.confidence, violations: [] }
  let judgeViolations = normalizedJudgeViolations(judgeRequest, judgeResponse)
  const hostOwnedMessage = agentRequest?.responseContract?.hostOwnedMessage === true && Array.isArray(agentRequest?.responseContract?.jsonSchema?.properties?.message?.enum) && agentRequest.responseContract.jsonSchema.properties.message.enum.length === 1 && agentResponse.message === agentRequest.responseContract.jsonSchema.properties.message.enum[0]
  if (hostOwnedMessage && agentRequest.modelRole === 'tutor') {
    const deterministicCodes = new Set((judgeRequest.deterministicViolations || []).map(v => v.code))
    judgeViolations = judgeViolations.filter(v => {
      if (!['TUTOR_FINAL_ANSWER_LEAK', 'TUTOR_INTERNAL_STATE_DISCLOSURE', 'TUTOR_TASK_FACTUAL_ERROR', 'TUTOR_EXCESSIVE_ASSISTANCE', 'TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE', 'MODEL_RESPONSE_ENVELOPE_LEAK'].includes(v.code)) return true
      return deterministicCodes.has(v.code)
    })
  }
  if (hostOwnedMessage && agentRequest.modelRole === 'research') {
    const deterministicCodes = new Set((judgeRequest.deterministicViolations || []).map(v => v.code))
    judgeViolations = judgeViolations.filter(v => {
      if (!['RESEARCH_CONCLUSION_MIRROR_MISMATCH', 'MODEL_RESPONSE_ENVELOPE_LEAK', 'RESEARCH_CERTAINTY_OVERREACH', 'RESEARCH_USER_VISIBLE_PLACEHOLDER', 'RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE', 'RESEARCH_CLAIM_NOT_VISIBLE', 'RESEARCH_PROVENANCE_MISATTRIBUTION', 'RESEARCH_REQUESTED_EVIDENCE_NOT_VISIBLE', 'RESEARCH_VALIDATION_NEXT_STEP_NOT_VISIBLE'].includes(v.code)) return true
      return deterministicCodes.has(v.code)
    })
  }
  const combined = [...(judgeRequest.deterministicViolations || []), ...judgeViolations]
  const seen = new Set()
  const violations = combined.filter(v => { const k = `${v.code}:${v.evidenceQuote || ''}`; if (seen.has(k)) return false; seen.add(k); return true })
  if (violations.some(v => v.severity === 'error')) return { status: 'blocked', reason: 'policy-violation', confidence: judgeResponse.confidence, violations }
  return { status: 'deliver', reason: violations.length ? 'warnings-only' : 'policy-compliant', confidence: judgeResponse.confidence, violations }
}

export function compileStructuredRepairRequest(request, input = {}) {
  const repaired = jsonClone(request)
  const attempt = Math.max(1, Number(input.attempt ?? 1))
  const role = String(input.role || 'agent')
  repaired.requestId = input.requestId || `${request.requestId || role}:structured-repair:${attempt}`
  repaired.instructions = [...(repaired.instructions || [])]
  if (role === 'judge') {
    const itemProps = repaired.responseContract?.jsonSchema?.properties?.violations?.items?.properties
    const quoteSchema = itemProps?.evidenceQuote
    const rationaleSchema = itemProps?.rationale
    if (quoteSchema?.enum) quoteSchema.enum = [...quoteSchema.enum].sort((a, b) => String(a).length - String(b).length)
    if (quoteSchema) quoteSchema.maxLength = Math.min(Number.isFinite(quoteSchema.maxLength) ? quoteSchema.maxLength : 220, 220)
    if (rationaleSchema) rationaleSchema.maxLength = Math.min(Number.isFinite(rationaleSchema.maxLength) ? rationaleSchema.maxLength : 120, 120)
    repaired.instructions.push('Previous structured Judge output was invalid or truncated. Return one complete JSON object only. If noncompliant, select the SHORTEST evidenceQuoteCandidate that proves the issue and keep rationale <= 120 characters. Do not echo the full agent message.')
    return repaired
  }
  const messageSchema = repaired.responseContract?.jsonSchema?.properties?.message
  const rationaleSchema = repaired.responseContract?.jsonSchema?.properties?.action?.properties?.rationale
  if (repaired.modelRole === 'tutor') {
    if (messageSchema && !messageSchema.enum) messageSchema.maxLength = Math.min(Number.isFinite(messageSchema.maxLength) ? messageSchema.maxLength : 480, 480)
    if (rationaleSchema && !rationaleSchema.enum) rationaleSchema.maxLength = Math.min(Number.isFinite(rationaleSchema.maxLength) ? rationaleSchema.maxLength : 120, 120)
    repaired.instructions.push('Previous structured Agent output was invalid or truncated. Return exactly one complete JSON object. Keep message <= 480 characters and action.rationale <= 120 characters; do not repeat the message in rationale.')
  } else {
    repaired.instructions.push('Previous structured Agent output was invalid or truncated. Return exactly one complete JSON object matching responseContract; be concise and do not add commentary outside JSON.')
  }
  return repaired
}

function freezeResearchActionForHostOwnedRetry(request, previousResponse = null) {
  if (request?.modelRole !== 'research') return false
  const action = previousResponse?.action
  const actionSchema = request?.responseContract?.jsonSchema?.properties?.action
  const props = actionSchema?.properties
  if (!action || typeof action !== 'object' || !props) return false
  const allowed = new Set(request?.responseContract?.actionKinds || [])
  const kind = String(action.kind || '')
  if (!kind || !allowed.has(kind)) return false
  if (kind === 'claim-proposal') {
    const claim = action.claim
    if (!claim || typeof claim !== 'object' || !String(claim.id || '').trim() || !String(claim.text || '').trim()) return false
  }
  props.kind = { type: 'string', enum: [kind] }
  props.conclusionStatus = action.conclusionStatus === null || action.conclusionStatus === undefined
    ? { type: 'null' }
    : { type: 'string', enum: [String(action.conclusionStatus)] }
  props.conclusionDirection = action.conclusionDirection === null || action.conclusionDirection === undefined
    ? { type: 'null' }
    : { type: 'string', enum: [String(action.conclusionDirection)] }
  if (action.claim === null || action.claim === undefined) props.claim = { type: 'null' }
  else {
    props.claim = {
      type: 'object', additionalProperties: false, required: ['id','text','kind'],
      properties: {
        id: { type: 'string', enum: [String(action.claim.id)] },
        text: { type: 'string', enum: [String(action.claim.text)] },
        kind: { type: 'string', enum: [String(action.claim.kind || 'hypothesis')] },
      },
    }
  }
  props.plan = action.plan === null || action.plan === undefined
    ? { type: 'null' }
    : { type: 'string', enum: [String(action.plan)] }
  request.responseContract.hostOwnedAction = true
  request.responseContract.requiredActionKind = kind
  return true
}

export function compileRetryRequest(agentRequest, deliveryDecision, input = {}) {
  if (!['blocked', 'review'].includes(deliveryDecision?.status)) throw new Error('Retry request requires blocked/review delivery decision')
  const request = jsonClone(agentRequest)
  request.requestId = input.requestId || `${agentRequest.requestId}:retry:${Number(input.attempt ?? 1)}`
  const violations = (deliveryDecision.violations || []).map(v => ({ code: v.code, evidenceQuote: v.evidenceQuote || null, detail: v.detail || null }))
  const codes = violations.map(v => v.code)
  const blockedQuotes = [...new Set(violations.map(v => v.evidenceQuote).filter(Boolean))]
  const opposingEvidence = agentRequest.modelRole === 'research'
    ? (agentRequest.evidence || []).filter(e => String(e?.stance || '') === 'oppose').map(e => String(e?.summary || '')).filter(Boolean)
    : []
  const opposingDisclosureMode = agentRequest.modelRole === 'research'
    ? (agentRequest?.responseContract?.opposingEvidenceDisclosure || 'one')
    : null
  const sameTurnToolResults = input.sameTurnToolResults || []
  const correction = [
    `Host rejected the previous draft. Retry without violating: ${codes.join(', ') || deliveryDecision.reason}. Do not weaken or override the Profile policy.`,
    blockedQuotes.length ? `Do not repeat these blocked spans or equivalent final conclusions: ${blockedQuotes.map(x => JSON.stringify(x)).join(', ')}.` : null,
    agentRequest.modelRole === 'tutor' && codes.includes('TUTOR_FINAL_ANSWER_LEAK')
      ? 'For this retry, give only one concise diagnostic hint/question. Do not compute, state, equate, or compare the final numeric answer/candidate for the learner.'
      : null,
    agentRequest.modelRole === 'tutor' && codes.includes('TUTOR_TASK_FACTUAL_ERROR')
      ? 'For this retry, remove the false mathematical/factual assertion. Stay strictly on the supplied learner task and give only a correct, minimal next step grounded in the task/rubric.'
      : null,
    agentRequest.modelRole === 'research' && codes.includes('RESEARCH_CONFLICT_ERASURE') && opposingEvidence.length
      ? (opposingDisclosureMode === 'all'
        ? `For this retry, the USER-VISIBLE message must explicitly include ALL Host-owned opposing evidence items currently in the request, not merely say "retain counter-evidence". Opposing evidence summaries: ${opposingEvidence.map(x => JSON.stringify(x)).join('; ')}. Keep the Host conclusion qualified.`
        : `For this retry, the USER-VISIBLE message must explicitly acknowledge the substance of at least one Host-owned opposing evidence item, not merely say "retain counter-evidence". Opposing evidence summaries: ${opposingEvidence.slice(0, 3).map(x => JSON.stringify(x)).join('; ')}. Keep the Host conclusion qualified.`)
      : null,
  ].filter(Boolean)
  request.instructions = [...(request.instructions || []), ...correction]
  if (agentRequest.modelRole === 'tutor' && request.responseContract?.jsonSchema?.properties?.message) {
    const schema = request.responseContract.jsonSchema.properties.message
    schema.maxLength = Math.min(Number.isFinite(schema.maxLength) ? schema.maxLength : 480, 480)
    const rationaleSchema = request.responseContract?.jsonSchema?.properties?.action?.properties?.rationale
    if (rationaleSchema) {
      rationaleSchema.minLength = Math.max(Number.isFinite(rationaleSchema.minLength) ? rationaleSchema.minLength : 1, 1)
      rationaleSchema.maxLength = Math.min(Number.isFinite(rationaleSchema.maxLength) ? rationaleSchema.maxLength : 160, 160)
    }
    request.instructions.push('Retry output must be concise: user-visible message <= 480 characters; action.rationale <= 160 characters and MUST NOT repeat the message.')
    if (codes.some(code => ['TUTOR_FINAL_ANSWER_LEAK', 'TUTOR_INTERNAL_STATE_DISCLOSURE', 'TUTOR_TASK_FACTUAL_ERROR', 'TUTOR_EXCESSIVE_ASSISTANCE', 'TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE', 'MODEL_RESPONSE_ENVELOPE_LEAK'].includes(code))) {
      const privateOnly = codes.includes('TUTOR_INTERNAL_STATE_DISCLOSURE') && !codes.some(code => ['TUTOR_FINAL_ANSWER_LEAK', 'TUTOR_TASK_FACTUAL_ERROR', 'TUTOR_EXCESSIVE_ASSISTANCE', 'TUTOR_NEXT_PRACTICE_NOT_ACTIONABLE'].includes(code))
      const safeMessage = privateOnly ? hostOwnedTutorPrivateStateRetryMessage(request) : hostOwnedTutorSafeRetryMessage(request)
      schema.enum = [safeMessage]
      request.responseContract.hostOwnedMessage = true
      if (rationaleSchema) rationaleSchema.enum = ['host-policy-safe-retry']
      request.instructions.push(privateOnly
        ? 'This internal-state-disclosure retry is Host-restricted. Copy the single allowed user-visible message from responseContract exactly; do not add mastery, uncertainty, assessment counts, failure rates, verifier metrics, policy codes, or internal Host/retry commentary.'
        : 'This Tutor repair is Host-restricted. Copy the single allowed user-visible message from responseContract exactly; do not add numbers, equations, comparisons, worked examples, final answers, policy codes, or internal Host/retry commentary.')
    }
  }
  if (agentRequest.modelRole === 'research' && codes.some(code => ['RESEARCH_CONFLICT_ERASURE', 'RESEARCH_CONCLUSION_MIRROR_MISMATCH', 'MODEL_RESPONSE_ENVELOPE_LEAK', 'RESEARCH_CERTAINTY_OVERREACH', 'RESEARCH_USER_VISIBLE_PLACEHOLDER', 'RESEARCH_SAME_TURN_TOOL_ARTIFACT_NOT_VISIBLE', 'RESEARCH_CLAIM_NOT_VISIBLE', 'RESEARCH_PROVENANCE_MISATTRIBUTION', 'RESEARCH_REQUESTED_EVIDENCE_NOT_VISIBLE', 'RESEARCH_VALIDATION_NEXT_STEP_NOT_VISIBLE'].includes(code))) {
    const messageSchema = request.responseContract?.jsonSchema?.properties?.message
    const rationaleSchema = request.responseContract?.jsonSchema?.properties?.action?.properties?.rationale
    const needsSameTurnArtifact = sameTurnToolResults.length > 0
    const explicitOpposingDisclosure = agentRequest?.responseContract?.opposingEvidenceDisclosure || null
    const requestedEvidence = researchRequestedEvidenceSummaries(agentRequest).filter(x => x.summary).map(x => x.summary)
    const needsRequestedEvidence = requestedEvidence.length > 0 && (codes.includes('RESEARCH_REQUESTED_EVIDENCE_NOT_VISIBLE') || researchExplicitEvidenceIds(agentRequest).length > 0)
    const needsValidationNextStep = codes.includes('RESEARCH_VALIDATION_NEXT_STEP_NOT_VISIBLE') || researchRequestsValidationNextStep(agentRequest)
    const needsDisclosure = Boolean(opposingEvidence.length && (codes.includes('RESEARCH_CONFLICT_ERASURE') || explicitOpposingDisclosure === 'all' || explicitOpposingDisclosure === 'one'))
    if (needsDisclosure) request.instructions.push(opposingDisclosureMode === 'all'
      ? `For this retry, copy ALL Host-owned opposing evidence summaries VERBATIM into the USER-VISIBLE message. Required summaries: ${opposingEvidence.map(x => JSON.stringify(x)).join('; ')}.`
      : `For this retry, copy at least one Host-owned opposing evidence summary VERBATIM into the USER-VISIBLE message. Required verbatim candidates: ${opposingEvidence.slice(0, 3).map(x => JSON.stringify(x)).join('; ')}.`)
    const previousResponse = input.previousResponse || null
    let safeMessage = needsSameTurnArtifact
      ? hostOwnedResearchSameTurnArtifactRetryMessage(request, sameTurnToolResults, opposingEvidence, needsDisclosure ? opposingDisclosureMode : null)
      : needsDisclosure
        ? hostOwnedResearchDisclosureRetryMessage(request, opposingEvidence, opposingDisclosureMode)
        : hostOwnedResearchStateRetryMessage(request, previousResponse)
    if (needsRequestedEvidence && requestedEvidence.length) {
      const prefix = prefersCjkRetryCopy(request) ? ' 用户明确要求保留的证据：' : ' User-requested evidence retained: '
      safeMessage += `${prefix}${requestedEvidence.join('；')}`
    }
    if (needsValidationNextStep) {
      safeMessage += prefersCjkRetryCopy(request)
        ? ' 下一步仍需用独立验证、复现实验或新的独立证据检验当前假设及冲突。'
        : ' The next step still requires independent validation, replication, or new independent evidence to test the current hypothesis and unresolved conflict.'
    }
    if (messageSchema) messageSchema.enum = [safeMessage]
    request.responseContract.hostOwnedMessage = true
    const actionFrozen = freezeResearchActionForHostOwnedRetry(request, previousResponse)
    if (rationaleSchema) {
      rationaleSchema.maxLength = Math.min(Number.isFinite(rationaleSchema.maxLength) ? rationaleSchema.maxLength : 160, 160)
      rationaleSchema.enum = [needsDisclosure ? 'host-policy-mandatory-disclosure' : 'host-policy-safe-retry']
    }
    request.instructions.push(needsDisclosure
      ? 'This conflict-disclosure retry is Host-restricted. Copy the single allowed user-visible message from responseContract exactly. Do not mention Host rejection, retries, policy names/codes, implementation details, or claim that a violation strategy was executed.'
      : `This Research repair is Host-restricted. Copy the single allowed user-visible message from responseContract exactly. ${actionFrozen ? 'The structured action is also Host-pinned to the previously accepted action payload; copy it exactly except for the Host-owned rationale enum. ' : ''}Keep the structured action conclusion fields identical to the Host state and do not embed response/action JSON in the message.`)
  }
  request.retry = {
    attempt: Number(input.attempt ?? 1),
    reason: deliveryDecision.reason,
    violationCodes: codes,
    blockedEvidenceQuotes: blockedQuotes,
    correctionMode: 'host-owned-policy-retry',
  }
  return request
}

export function createTranscript(profile, initialState, metadata = {}) {
  return {
    schema: GPT_HOST_TRANSCRIPT_SCHEMA,
    model: {
      provider: String(metadata.provider || 'unknown'),
      model: String(metadata.model || 'unknown'),
      transport: String(metadata.transport || 'provider-neutral'),
      independenceGroup: metadata.independenceGroup || null,
    },
    profile: { id: profile.id, kind: profile.kind, version: profile.version, fingerprint: fingerprintProfile(profile) },
    initialState: jsonClone(initialState),
    turns: [],
    profileEntries: [],
  }
}

export function appendTranscriptStep(transcript, step) {
  const row = {
    seq: transcript.turns.length + 1,
    phase: step.phase,
    request: jsonClone(step.request),
    modelResponse: jsonClone(step.modelResponse),
    hostEvent: jsonClone(step.event),
    stateAfter: jsonClone(step.state),
  }
  transcript.turns.push(row)
  if (step.snapshot) transcript.profileEntries.push({ snapshotSeq: transcript.profileEntries.length + 1, kind: 'profile', endReason: step.snapshot.transaction.endReason, snapshot: jsonClone(step.snapshot) })
  return row
}

export function transcriptToAppSession(profile, transcript, title = 'PPL LLM Host Adapter', options = {}) {
  return {
    schema: 'ppl.app-session/0.3',
    title,
    profile: { id: profile.id, title: profile.title || profile.id, kind: profile.kind, version: profile.version, engine: jsonClone(profile.engine) },
    domain: {
      profileKind: profile.kind,
      engine: jsonClone(profile.engine),
      application: jsonClone(profile.application),
      host: String(options.host || 'ppl-llm-host-adapter'),
      model: jsonClone(transcript.model || null),
    },
    observability: jsonClone(profile.observability),
    literature: jsonClone(profile.literature || []),
    entries: jsonClone(transcript.profileEntries),
  }
}
