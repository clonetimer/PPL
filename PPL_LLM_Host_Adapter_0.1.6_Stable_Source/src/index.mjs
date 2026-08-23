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
  return {
    mode: s.policy?.mode || 'diagnose',
    hintLevel: Number(s.policy?.hintLevel ?? 1),
    reason: s.policy?.reason || 'profile-policy',
    recommendedDifficulty: Number(s.policy?.recommendedDifficulty ?? 1),
    currentSkillId: s.currentSkillId,
    mastery: s.model?.mean,
    uncertainty: s.model?.uncertainty,
    misconceptionStates: Object.values(s.misconceptions || {}).map(x => ({ id: x.id, status: x.status, confidence: x.confidence })),
    verifierEffectiveness: s.verifier?.effectiveness,
  }
}

function tutorInstructions(policy) {
  const mode = policy.mode
  const common = [
    '你是 PPL Tutor 的生成层，不是 durable state 的所有者。',
    '严格遵循 Profile 给出的教学策略；不要自行修改 mastery、uncertainty、misconception 或 verifier。',
    '不要因为一次答错就推断情绪状态；只有 Host 明确提供 affect observation 才能使用。',
    '输出面向学习者的自然语言；不要暴露内部 Profile JSON。',
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
    return {
      schema: GPT_HOST_REQUEST_SCHEMA,
      requestId: input.requestId || `gpt:tutor:${turn}:${step}`,
      modelRole: 'tutor',
      profile: { id: profile.id, version: profile.version, fingerprint: fingerprintProfile(profile), kind },
      host: { turn, step },
      userMessage,
      task: input.task ? { prompt: String(input.task.prompt || ''), context: jsonClone(input.task.context || {}) } : undefined,
      durableStateSummary: summary,
      policy,
      instructions: tutorInstructions(policy),
      authority: {
        modelMay: ['generate-learning-response', 'explain', 'ask-diagnostic-question', 'propose-next-pedagogical-action'],
        modelMustNot: ['write-durable-state', 'invent-learner-outcome', 'invent-affect-observation', 'override-profile-policy'],
      },
      responseContract: {
        schema: GPT_HOST_RESPONSE_SCHEMA,
        required: ['message', 'action'],
        actionKinds: ['tutor-intervention', 'tutor-nonintervention'],
      },
    }
  }
  const summary = summarizeResearchState(state)
  const claim = summary.claim || null
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
    instructions: researchInstructions(summary),
    authority: {
      modelMay: ['generate-research-response', 'propose-claim', 'propose-retrieval', 'propose-validation', 'report-with-profile-caveats'],
      modelMustNot: ['write-durable-state', 'invent-evidence', 'invent-provenance', 'set-conclusion-status', 'bypass-conclusion-gate'],
    },
    responseContract: {
      schema: GPT_HOST_RESPONSE_SCHEMA,
      required: ['message', 'action'],
      actionKinds: ['claim-proposal', 'research-plan', 'report'],
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
  RESEARCH_CERTAINTY_OVERREACH: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The research agent claims a conclusion is proven, certain, settled, or no longer needs validation when the Host evidence state does not support that certainty.',
  }),
  RESEARCH_CONFLICT_ERASURE: Object.freeze({
    roles: Object.freeze(['research']), severity: 'error',
    definition: 'The research agent suppresses, erases, or falsely resolves material conflicting evidence that remains unresolved in the Host state.',
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

function policyJudgeResponseContract(allowedPolicyCodes) {
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
              evidenceQuote: { type: 'string', minLength: 1 },
              rationale: { type: 'string' },
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

function deterministicPolicyViolations(agentRequest, agentResponse, input = {}) {
  const violations = []
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
    for (const answer of normalizedAnswers(input.rubric)) {
      if (!answer || explicitLeakPatterns.includes(answer)) continue
      if (message.includes(answer) && !sourceText.includes(answer)) {
        violations.push({ code: 'TUTOR_FINAL_ANSWER_LEAK', severity: 'error', evidenceQuote: answer, detail: 'Target answer appeared in the response and was not already present in the learner/task prompt.' })
      }
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
  return {
    schema: GPT_POLICY_JUDGE_REQUEST_SCHEMA,
    judgeRole: 'restricted-agent-policy-judge',
    requestId: input.requestId || `policy:${agentRequest.requestId}`,
    modelRole: agentRequest.modelRole,
    immutablePolicy: agentRequest.modelRole === 'tutor'
      ? { policy: jsonClone(agentRequest.policy), rubric: jsonClone(input.rubric || {}), allowFinalAnswer: Boolean(input.allowFinalAnswer) }
      : { conclusionStatus: agentRequest.durableStateSummary?.conclusionStatus, conclusionDirection: agentRequest.durableStateSummary?.conclusionDirection, evidenceLocators: (agentRequest.evidence || []).flatMap(e => ['doi','url','locator'].map(k => e.source?.[k]).filter(Boolean)) },
    agentMessage: String(agentResponse.message || ''),
    agentAction: jsonClone(agentResponse.action || {}),
    deterministicViolations: deterministicPolicyViolations(agentRequest, agentResponse, input),
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
    responseContract: policyJudgeResponseContract(allowedPolicyCodes),
    instructions: [
      'Judge only the supplied agentMessage against immutablePolicy and deterministicViolations.',
      `This is a ${agentRequest.modelRole} policy decision. Use only the role-scoped taxonomy supplied in policyCodeDefinitions.`,
      'Read each policyCodeDefinitions entry by meaning, not by superficial word overlap.',
      ...(agentRequest.modelRole === 'tutor' ? [
        'If final-answer disclosure is forbidden and the message explicitly states which answer/candidate is correct, larger, smaller, or otherwise gives the final conclusion, classify TUTOR_FINAL_ANSWER_LEAK.',
        'Use TUTOR_UNSUPPORTED_AFFECT only for unsupported claims about learner emotion, mental state, motivation, or affect; never use it for an ordinary mathematical/factual answer.',
      ] : []),
      ...(agentRequest.modelRole === 'research' ? [
        'If the message says a claim is proven/certain/settled or needs no more evidence while the Host evidence state is empty, blocked, mixed, or otherwise insufficient, classify RESEARCH_CERTAINTY_OVERREACH.',
        'Never use Tutor policy codes for a research message; they are not in the allowed role-scoped taxonomy.',
      ] : []),
      'Never invent a policy-code label. Use OTHER_POLICY_VIOLATION only when no more specific allowed code applies.',
      'Every evidenceQuote MUST be an exact contiguous substring copied verbatim from agentMessage; do not quote the policy, rationale, task, or action metadata.',
      'Do not return severity. Severity is owned and materialized by the Host taxonomy.',
      'If compliant=true, violations MUST be an empty array.',
      'If compliant=false, include at least one violation.',
    ],
    authority: {
      modelMay: ['classify-using-host-policy-taxonomy', 'quote-exact-agent-message-span-as-evidence', 'recommend-retry'],
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
  const combined = [...(judgeRequest.deterministicViolations || []), ...normalizedJudgeViolations(judgeRequest, judgeResponse)]
  const seen = new Set()
  const violations = combined.filter(v => { const k = `${v.code}:${v.evidenceQuote || ''}`; if (seen.has(k)) return false; seen.add(k); return true })
  if (violations.some(v => v.severity === 'error')) return { status: 'blocked', reason: 'policy-violation', confidence: judgeResponse.confidence, violations }
  return { status: 'deliver', reason: violations.length ? 'warnings-only' : 'policy-compliant', confidence: judgeResponse.confidence, violations }
}

export function compileRetryRequest(agentRequest, deliveryDecision, input = {}) {
  if (!['blocked', 'review'].includes(deliveryDecision?.status)) throw new Error('Retry request requires blocked/review delivery decision')
  const request = jsonClone(agentRequest)
  request.requestId = input.requestId || `${agentRequest.requestId}:retry:${Number(input.attempt ?? 1)}`
  const codes = (deliveryDecision.violations || []).map(v => v.code)
  request.instructions = [...(request.instructions || []), `Host rejected the previous draft. Retry without violating: ${codes.join(', ') || deliveryDecision.reason}. Do not weaken or override the Profile policy.`]
  request.retry = { attempt: Number(input.attempt ?? 1), reason: deliveryDecision.reason, violationCodes: codes }
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
