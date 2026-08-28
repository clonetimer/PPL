import { createHash } from 'node:crypto'
import { applyProfileEvent } from 'ppl-llm-host-adapter/contracts'

export const LIFE_HOST_BINDING_SCHEMA = 'ppl.host-binding.life/0.1'
const HOST_REQUEST_SCHEMA = 'ppl.gpt-host-request/0.1'
const HOST_RESPONSE_SCHEMA = 'ppl.gpt-host-response/0.1'

function clone(x) { return JSON.parse(JSON.stringify(x)) }
function fingerprint(profile) { return createHash('sha256').update(JSON.stringify(profile)).digest('hex') }
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] })
const nullOnly = () => ({ type: 'null' })

function prefersCjk(text) { return /[\u3400-\u9fff]/u.test(String(text || '')) }
function hostOwnedHighRiskMessage(userMessage = '') {
  return prefersCjk(userMessage)
    ? '这个请求需要权威专业判断。我不能替代相关专业人员给出确定结论；请向相应的合格专业人员或权威服务求助。'
    : 'This request requires authoritative professional judgment. I cannot replace the relevant qualified professional with a definitive conclusion; please seek the appropriate qualified professional or authoritative service.'
}

function normalizedUserVisibleText(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').replace(/[。.!！?？]+$/gu, '').trim().toLowerCase()
}
function compactUserVisibleText(value) {
  return normalizedUserVisibleText(value).replace(/[\s，。,.：:；;！？!?、‘’“”"'`()\[\]{}<>《》【】]/gu, '')
}
function isEchoOnlyServiceMessage(userMessage, message) {
  const user = compactUserVisibleText(userMessage)
  const out = compactUserVisibleText(message)
  if (!user || !out) return false
  if (user === out) return true
  if (out.length >= 12 && user.includes(out) && out.length / user.length >= 0.55) return true
  return false
}

const LIFE_INTERNAL_META_PATTERNS = [
  /\bPPL\b/iu,
  /\blife-service-response\b/iu,
  /\bhostRisk\b/u,
  /\bresponseContract\b/u,
  /\bdurableStateSummary\b/u,
  /\bmutationAuthorization\b/u,
  /\brequest\.realtimeFacts\b/u,
  /\bquietPlaces\b/u,
  /\bmorningPlanning\b/u,
  /\bescalationRequired\b/u,
]
function internalLifeMetaSpan(message) {
  const text = String(message || '')
  for (const pattern of LIFE_INTERNAL_META_PATTERNS) {
    const match = text.match(pattern)
    if (match) return match[0]
  }
  return null
}
function normalizedServiceFallback(input, allowedCitationLocators) {
  const raw = input?.hostOwnedServiceFallback
  if (!raw) return null
  const message = String(raw.message || '').trim()
  if (!message) throw new Error('hostOwnedServiceFallback.message required')
  const allowed = new Set(allowedCitationLocators)
  const citations = [...new Set((raw.citations || []).map(String).filter(Boolean))]
  for (const citation of citations) if (!allowed.has(citation)) throw new Error(`hostOwnedServiceFallback citation not present in Host realtime facts: ${citation}`)
  if (internalLifeMetaSpan(message)) throw new Error('hostOwnedServiceFallback.message must not contain Life internal contract identifiers')
  return { message, citations }
}

function preferenceObjectSchema(requiredPreference = null) {
  return { type: 'object', additionalProperties: false, required: ['key','value'], properties: {
    key: requiredPreference ? { type: 'string', enum: [String(requiredPreference.key)] } : { type: 'string', enum: ['quietPlaces','morningPlanning'] },
    value: requiredPreference ? { type: 'boolean', enum: [Boolean(requiredPreference.value)] } : { type: 'boolean' },
  } }
}
function planObjectSchema(requiredPlan = null) {
  return { type: 'object', additionalProperties: false, required: ['plan'], properties: { plan: requiredPlan ? { type: 'string', enum: [String(requiredPlan)] } : { type: 'string', minLength: 1 } } }
}
function escalationObjectSchema() {
  return { type: 'object', additionalProperties: false, required: ['required','reason'], properties: {
    required: { type: 'boolean', enum: [true] }, reason: { type: 'string', minLength: 1 },
  } }
}
function actionBranch(kind, fields) {
  return { type: 'object', additionalProperties: false, required: ['kind','rationale','preference','plan','escalation'], properties: {
    kind: { type: 'string', enum: [kind] },
    rationale: { type: 'string', minLength: 1 },
    preference: fields.preference,
    plan: fields.plan,
    escalation: fields.escalation,
  } }
}

export function lifeResponseJsonSchema(options = {}) {
  const allowedCitationLocators = [...new Set((options.allowedCitationLocators || []).map(String).filter(Boolean))]
  const actionKinds = new Set(options.actionKinds || ['life-service-response','life-preference-proposal','life-plan-proposal','life-escalation'])
  const requiredMessage = options.requiredMessage ? String(options.requiredMessage) : null
  const requiredPlan = options.requiredPlan ? String(options.requiredPlan) : null
  const requiredPreference = options.requiredPreference ? { key: String(options.requiredPreference.key), value: Boolean(options.requiredPreference.value) } : null
  const citations = allowedCitationLocators.length
    ? { type: 'array', uniqueItems: true, items: { type: 'string', enum: allowedCitationLocators } }
    : { type: 'array', maxItems: 0, items: { type: 'string' } }
  return {
    type: 'object', additionalProperties: false, required: ['schema','message','action','citations'],
    properties: {
      schema: { type: 'string', enum: [HOST_RESPONSE_SCHEMA] },
      message: requiredMessage ? { type: 'string', enum: [requiredMessage] } : { type: 'string', minLength: 1 },
      action: { anyOf: [
        ...(actionKinds.has('life-service-response') ? [actionBranch('life-service-response', { preference: nullOnly(), plan: nullOnly(), escalation: nullOnly() })] : []),
        ...(actionKinds.has('life-preference-proposal') ? [actionBranch('life-preference-proposal', { preference: preferenceObjectSchema(requiredPreference), plan: nullOnly(), escalation: nullOnly() })] : []),
        ...(actionKinds.has('life-plan-proposal') ? [actionBranch('life-plan-proposal', { preference: nullOnly(), plan: planObjectSchema(requiredPlan), escalation: nullOnly() })] : []),
        ...(actionKinds.has('life-escalation') ? [actionBranch('life-escalation', { preference: nullOnly(), plan: nullOnly(), escalation: escalationObjectSchema() })] : []),
      ] },
      citations,
    },
  }
}

function validateRealtimeFact(fact, index) {
  if (!fact || typeof fact !== 'object') throw new Error(`realtimeFacts[${index}] must be object`)
  if (!fact.locator) throw new Error(`realtimeFacts[${index}] requires Host-owned locator`)
  if (!fact.observedAt) throw new Error(`realtimeFacts[${index}] requires observedAt`)
  if (fact.value === undefined) throw new Error(`realtimeFacts[${index}] requires value`)
  return { locator: String(fact.locator), observedAt: String(fact.observedAt), value: clone(fact.value), sourceKind: String(fact.sourceKind || 'host-tool') }
}

export function compileLifeHostRequest(profile, state, input = {}) {
  if (profile?.kind !== 'life') throw new Error('Life profile required')
  if (!state || typeof state !== 'object') throw new Error('Life state required')
  const facts = (input.realtimeFacts || []).map(validateRealtimeFact)
  const allowedCitationLocators = facts.map(x => x.locator)
  const risk = input.hostRisk ? { level: String(input.hostRisk.level || 'normal'), reason: String(input.hostRisk.reason || ''), authoritativeLayer: input.hostRisk.authoritativeLayer ? String(input.hostRisk.authoritativeLayer) : null } : { level: 'normal', reason: '', authoritativeLayer: null }
  const mutationAuthorization = {
    preference: Boolean(input.mutationAuthorization?.preference),
    plan: Boolean(input.mutationAuthorization?.plan),
  }
  const baseActionKinds = risk.level === 'high'
    ? ['life-escalation']
    : ['life-service-response', ...(mutationAuthorization.preference ? ['life-preference-proposal'] : []), ...(mutationAuthorization.plan ? ['life-plan-proposal'] : [])]
  const requiredActionKind = input.requiredActionKind ? String(input.requiredActionKind) : null
  if (requiredActionKind && !baseActionKinds.includes(requiredActionKind)) throw new Error(`requiredActionKind ${requiredActionKind} is not authorized for this Life request`)
  const actionKinds = requiredActionKind ? [requiredActionKind] : baseActionKinds
  const requiredPlan = input.requiredPlan ? String(input.requiredPlan).trim() : null
  const requiredPreference = input.requiredPreference ? { key: String(input.requiredPreference.key || ''), value: Boolean(input.requiredPreference.value) } : null
  if (requiredPlan && (!mutationAuthorization.plan || requiredActionKind !== 'life-plan-proposal')) throw new Error('requiredPlan requires authorized requiredActionKind=life-plan-proposal')
  if (requiredPreference && (!mutationAuthorization.preference || requiredActionKind !== 'life-preference-proposal')) throw new Error('requiredPreference requires authorized requiredActionKind=life-preference-proposal')
  if (requiredPreference && !['quietPlaces','morningPlanning'].includes(requiredPreference.key)) throw new Error(`Unsupported requiredPreference key: ${requiredPreference.key}`)
  const requiredMessage = risk.level === 'high' ? hostOwnedHighRiskMessage(input.userMessage) : null
  const hostOwnedServiceFallback = risk.level !== 'high' && actionKinds.includes('life-service-response')
    ? normalizedServiceFallback(input, allowedCitationLocators)
    : null
  return {
    schema: HOST_REQUEST_SCHEMA,
    requestId: input.requestId || `gpt:life:${input.turn ?? 1}:${input.step ?? 1}`,
    modelRole: 'life',
    profile: { id: profile.id, version: profile.version, fingerprint: fingerprint(profile), kind: profile.kind },
    host: { turn: Number(input.turn ?? 1), step: Number(input.step ?? 1) },
    userMessage: String(input.userMessage || ''),
    durableStateSummary: { preferences: clone(state.preferences || {}), plan: clone(state.plan || {}), service: clone(state.service || {}) },
    realtimeFacts: facts,
    hostRisk: risk,
    mutationAuthorization,
    instructions: [
      '你是 PPL Life 的生成层，不是 durable state、实时事实或高风险判断的所有者。',
      '实时事实只能使用 request.realtimeFacts；不得把实时事实写入长期偏好或计划状态。',
      '只有 mutationAuthorization 明确允许时，才能提出对应 preference/plan proposal；proposal 仍由 Host 决定是否提交。',
      'hostRisk.level=high 时必须选择 life-escalation，不得绕过 authoritativeLayer。',
      ...(requiredMessage ? [`高风险用户可见文本由 Host 固定：message 必须逐字复制 responseContract.requiredMessage，不得替代权威专业层给出诊断、裁决或确定结论。`] : []),
      '不得发明天气、营业状态、价格、医疗、法律或财务事实。',
      'life-service-response 的用户可见 message 必须实际回答/确认用户请求；不得把 userMessage 原样或仅做标点/空白变化后回显作为唯一回复。',
      '用户可见 message 不得暴露 PPL/Life 内部合同、字段名或执行元语言，例如 life-service-response、hostRisk、responseContract、durableStateSummary、mutationAuthorization、request.realtimeFacts、quietPlaces、morningPlanning、escalationRequired。',
      ...(hostOwnedServiceFallback ? ['若模型输出未通过普通服务合同，Host 可以使用 responseContract.hostOwnedServiceFallback 作为确定性用户可见恢复；模型不得修改该 fallback。'] : []),
      'citations 只能填写 request.realtimeFacts[].locator 中出现的精确 locator 字符串；不要填写 request.realtimeFacts、schema、policy、hostRisk 或解释性文字。',
      allowedCitationLocators.length ? `本轮允许的 citation locator 仅为：${allowedCitationLocators.join(', ')}。如果回答没有使用该实时事实，也可以 citations=[]。` : '本轮没有 Host realtime fact，因此 citations 必须是空数组 []。',
      `本轮 Host 允许的 action.kind 仅为：${actionKinds.join(', ')}。不得输出其他 action kind。`,
      ...(requiredPlan ? [`本轮用户明确授权的计划 payload 已由 Host 固定为：${requiredPlan}。action.plan.plan 必须逐字匹配，不得回填旧计划或改成其他计划。`] : []),
      ...(requiredPreference ? [`本轮用户明确授权的偏好 payload 已由 Host 固定为：${requiredPreference.key}=${requiredPreference.value}。action.preference 必须精确匹配。`] : []),
      'action.kind=life-preference-proposal 时 preference 必须是 {key,value}；action.kind=life-plan-proposal 时 plan 必须是 {plan}；action.kind=life-escalation 时 escalation 必须是 {required:true,reason}；其他不适用字段必须为 null。',
      '当前 request.hostRisk 是本轮风险边界的唯一权威来源；durableStateSummary.service 中历史 escalationRequired 不得覆盖本轮 hostRisk。',
    ],
    authority: {
      modelMay: ['generate-service-response','use-host-realtime-facts','propose-authorized-preference','propose-authorized-plan','surface-host-escalation'],
      modelMustNot: ['write-durable-state','invent-realtime-facts','persist-realtime-facts','make-high-risk-authority-decision','bypass-authoritative-layer'],
    },
    responseContract: {
      schema: HOST_RESPONSE_SCHEMA,
      actionKinds,
      requiredActionKind,
      requiredMessage,
      requiredPlan,
      requiredPreference,
      hostOwnedServiceFallback,
      allowedCitationLocators,
      jsonSchema: lifeResponseJsonSchema({ allowedCitationLocators, actionKinds, requiredMessage, requiredPlan, requiredPreference }),
    },
  }
}

export function validateLifeHostResponse(request, response) {
  const errors = []
  if (request?.schema !== HOST_REQUEST_SCHEMA || request?.modelRole !== 'life') errors.push('invalid life host request')
  if (response?.schema !== HOST_RESPONSE_SCHEMA) errors.push('response schema mismatch')
  if (typeof response?.message !== 'string' || !response.message.trim()) errors.push('response.message required')
  const action = response?.action
  if (!action || typeof action !== 'object') errors.push('response.action required')
  const allowed = new Set(request?.responseContract?.actionKinds || [])
  if (!allowed.has(action?.kind)) errors.push(`action kind ${action?.kind} not allowed`)
  if (request?.responseContract?.requiredActionKind && action?.kind !== request.responseContract.requiredActionKind) errors.push(`action kind ${action?.kind} does not satisfy requiredActionKind ${request.responseContract.requiredActionKind}`)
  for (const forbidden of ['durableStatePatch','statePatch','profileMutation','realtimeFactMutation']) if (forbidden in (response || {})) errors.push(`${forbidden} is forbidden`)
  if (action?.kind === 'life-service-response') {
    if (action?.preference !== null) errors.push('life-service-response.preference must be null')
    if (action?.plan !== null) errors.push('life-service-response.plan must be null')
    if (action?.escalation !== null) errors.push('life-service-response.escalation must be null')
    if (isEchoOnlyServiceMessage(request?.userMessage, response?.message)) errors.push('life-service-response must not merely echo userMessage without answering')
    const metaSpan = internalLifeMetaSpan(response?.message)
    if (metaSpan) errors.push(`life-service-response must not expose internal Life contract/meta identifier: ${metaSpan}`)
  }
  if (action?.kind === 'life-preference-proposal') {
    if (!request.mutationAuthorization?.preference) errors.push('preference proposal not authorized by Host/user input')
    if (!['quietPlaces','morningPlanning'].includes(action?.preference?.key)) errors.push('unsupported preference key')
    if (typeof action?.preference?.value !== 'boolean') errors.push('preference value must be boolean')
    const requiredPreference = request?.responseContract?.requiredPreference
    if (requiredPreference && (action?.preference?.key !== requiredPreference.key || action?.preference?.value !== requiredPreference.value)) errors.push('preference proposal does not match Host-authorized requiredPreference payload')
    if (action?.plan !== null || action?.escalation !== null) errors.push('preference proposal requires plan/escalation null')
  }
  if (action?.kind === 'life-plan-proposal') {
    if (!request.mutationAuthorization?.plan) errors.push('plan proposal not authorized by Host/user input')
    if (!String(action?.plan?.plan || '').trim()) errors.push('plan proposal requires plan text')
    const requiredPlan = request?.responseContract?.requiredPlan
    if (requiredPlan && action?.plan?.plan !== requiredPlan) errors.push('plan proposal does not match Host-authorized requiredPlan payload')
    if (action?.preference !== null || action?.escalation !== null) errors.push('plan proposal requires preference/escalation null')
  }
  if (action?.kind === 'life-escalation') {
    if (action?.preference !== null || action?.plan !== null) errors.push('life-escalation requires preference/plan null')
  }
  if (request?.hostRisk?.level === 'high') {
    if (action?.kind !== 'life-escalation') errors.push('high-risk Host classification requires life-escalation')
    if (action?.escalation?.required !== true) errors.push('high-risk escalation.required must be true')
    if (request?.responseContract?.requiredMessage && response?.message !== request.responseContract.requiredMessage) errors.push('high-risk message must match Host-owned escalation copy exactly')
  }
  const allowedLocators = new Set((request?.realtimeFacts || []).map(x => String(x.locator)))
  for (const citation of response?.citations || []) if (!allowedLocators.has(String(citation))) errors.push(`citation not present in Host realtime facts: ${citation}`)
  return { valid: errors.length === 0, errors }
}

export function buildLifeHostOwnedServiceFallback(request, reason = 'life-service-response-contract-repair') {
  const fallback = request?.responseContract?.hostOwnedServiceFallback
  if (!fallback) return null
  if (!(request?.responseContract?.actionKinds || []).includes('life-service-response')) return null
  const response = {
    schema: HOST_RESPONSE_SCHEMA,
    message: fallback.message,
    action: { kind: 'life-service-response', rationale: String(reason || 'host-owned-service-fallback'), preference: null, plan: null, escalation: null },
    citations: [...(fallback.citations || [])],
  }
  const check = validateLifeHostResponse(request, response)
  if (!check.valid) throw new Error(`Invalid Host-owned Life service fallback: ${check.errors.join('; ')}`)
  return response
}

export function buildLifeHostOwnedMutationFallback(request, reason = 'life-authorized-mutation-contract-repair') {
  const kind = request?.responseContract?.requiredActionKind
  let action = null
  let message = null
  if (kind === 'life-plan-proposal' && request?.responseContract?.requiredPlan) {
    const plan = String(request.responseContract.requiredPlan)
    action = { kind, rationale: String(reason), preference: null, plan: { plan }, escalation: null }
    message = prefersCjk(request?.userMessage)
      ? `已将当前计划更新为：${plan}`
      : `The current plan is now: ${plan}`
  } else if (kind === 'life-preference-proposal' && request?.responseContract?.requiredPreference) {
    const preference = clone(request.responseContract.requiredPreference)
    action = { kind, rationale: String(reason), preference, plan: null, escalation: null }
    if (prefersCjk(request?.userMessage)) {
      if (preference.key === 'quietPlaces') message = preference.value ? '已将长期偏好更新为：优先安静地点。' : '已取消长期“优先安静地点”偏好。'
      else message = `已将长期偏好 ${preference.key} 更新为 ${preference.value}。`
    } else message = `Updated long-term preference ${preference.key} to ${preference.value}.`
  }
  if (!action) return null
  const response = { schema: HOST_RESPONSE_SCHEMA, message, action, citations: [] }
  const check = validateLifeHostResponse(request, response)
  if (!check.valid) throw new Error(`Invalid Host-owned Life mutation fallback: ${check.errors.join('; ')}`)
  return response
}

export function applyLifeModelResponse(profile, durableState, request, response) {
  const check = validateLifeHostResponse(request, response)
  if (!check.valid) throw new Error(`Invalid Life host response: ${check.errors.join('; ')}`)
  const action = response.action
  if (action.kind === 'life-preference-proposal') {
    const event = { id: `life-pref:${request.requestId}`, type: 'PREFERENCE_SET', payload: clone(action.preference) }
    return { ...applyProfileEvent(profile, durableState, event, request.host, 'completed'), event, model: clone(response) }
  }
  if (action.kind === 'life-plan-proposal') {
    const event = { id: `life-plan:${request.requestId}`, type: 'PLAN_SET', payload: { plan: action.plan.plan } }
    return { ...applyProfileEvent(profile, durableState, event, request.host, 'completed'), event, model: clone(response) }
  }
  return { state: clone(durableState), event: null, snapshot: null, finalized: { committed: false, status: 'no-state-mutation', state: clone(durableState) }, model: clone(response) }
}

export function applyLifeHostRisk(profile, durableState, input = {}) {
  const event = { id: input.id || `life-risk:${Date.now()}`, type: 'HIGH_RISK_REQUEST', payload: { reason: String(input.reason || '') } }
  return { ...applyProfileEvent(profile, durableState, event, input.host || {}, 'completed'), event }
}

export function observeLifeRealtimeFact(profile, durableState, input = {}) {
  const event = { id: input.id || `life-fact:${Date.now()}`, type: 'REALTIME_FACT_OBSERVED', payload: { locator: String(input.locator || '') } }
  return { ...applyProfileEvent(profile, durableState, event, input.host || {}, 'completed'), event }
}
