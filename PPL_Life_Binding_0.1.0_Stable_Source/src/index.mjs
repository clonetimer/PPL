import { createHash } from 'node:crypto'
import { applyProfileEvent } from 'ppl-llm-host-adapter/contracts'

export const LIFE_HOST_BINDING_SCHEMA = 'ppl.host-binding.life/0.1'
const HOST_REQUEST_SCHEMA = 'ppl.gpt-host-request/0.1'
const HOST_RESPONSE_SCHEMA = 'ppl.gpt-host-response/0.1'

function clone(x) { return JSON.parse(JSON.stringify(x)) }
function fingerprint(profile) { return createHash('sha256').update(JSON.stringify(profile)).digest('hex') }
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] })
const nullOnly = () => ({ type: 'null' })

function preferenceObjectSchema() {
  return { type: 'object', additionalProperties: false, required: ['key','value'], properties: {
    key: { type: 'string', enum: ['quietPlaces','morningPlanning'] },
    value: { type: 'boolean' },
  } }
}
function planObjectSchema() {
  return { type: 'object', additionalProperties: false, required: ['plan'], properties: { plan: { type: 'string', minLength: 1 } } }
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
  const citations = allowedCitationLocators.length
    ? { type: 'array', uniqueItems: true, items: { type: 'string', enum: allowedCitationLocators } }
    : { type: 'array', maxItems: 0, items: { type: 'string' } }
  return {
    type: 'object', additionalProperties: false, required: ['schema','message','action','citations'],
    properties: {
      schema: { type: 'string', enum: [HOST_RESPONSE_SCHEMA] },
      message: { type: 'string', minLength: 1 },
      action: { anyOf: [
        ...(actionKinds.has('life-service-response') ? [actionBranch('life-service-response', { preference: nullOnly(), plan: nullOnly(), escalation: nullOnly() })] : []),
        ...(actionKinds.has('life-preference-proposal') ? [actionBranch('life-preference-proposal', { preference: preferenceObjectSchema(), plan: nullOnly(), escalation: nullOnly() })] : []),
        ...(actionKinds.has('life-plan-proposal') ? [actionBranch('life-plan-proposal', { preference: nullOnly(), plan: planObjectSchema(), escalation: nullOnly() })] : []),
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
  const actionKinds = risk.level === 'high'
    ? ['life-escalation']
    : ['life-service-response', ...(mutationAuthorization.preference ? ['life-preference-proposal'] : []), ...(mutationAuthorization.plan ? ['life-plan-proposal'] : [])]
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
      '不得发明天气、营业状态、价格、医疗、法律或财务事实。',
      'citations 只能填写 request.realtimeFacts[].locator 中出现的精确 locator 字符串；不要填写 request.realtimeFacts、schema、policy、hostRisk 或解释性文字。',
      allowedCitationLocators.length ? `本轮允许的 citation locator 仅为：${allowedCitationLocators.join(', ')}。如果回答没有使用该实时事实，也可以 citations=[]。` : '本轮没有 Host realtime fact，因此 citations 必须是空数组 []。',
      `本轮 Host 允许的 action.kind 仅为：${actionKinds.join(', ')}。不得输出其他 action kind。`,
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
      allowedCitationLocators,
      jsonSchema: lifeResponseJsonSchema({ allowedCitationLocators, actionKinds }),
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
  for (const forbidden of ['durableStatePatch','statePatch','profileMutation','realtimeFactMutation']) if (forbidden in (response || {})) errors.push(`${forbidden} is forbidden`)
  if (action?.kind === 'life-service-response') {
    if (action?.preference !== null) errors.push('life-service-response.preference must be null')
    if (action?.plan !== null) errors.push('life-service-response.plan must be null')
    if (action?.escalation !== null) errors.push('life-service-response.escalation must be null')
  }
  if (action?.kind === 'life-preference-proposal') {
    if (!request.mutationAuthorization?.preference) errors.push('preference proposal not authorized by Host/user input')
    if (!['quietPlaces','morningPlanning'].includes(action?.preference?.key)) errors.push('unsupported preference key')
    if (typeof action?.preference?.value !== 'boolean') errors.push('preference value must be boolean')
    if (action?.plan !== null || action?.escalation !== null) errors.push('preference proposal requires plan/escalation null')
  }
  if (action?.kind === 'life-plan-proposal') {
    if (!request.mutationAuthorization?.plan) errors.push('plan proposal not authorized by Host/user input')
    if (!String(action?.plan?.plan || '').trim()) errors.push('plan proposal requires plan text')
    if (action?.preference !== null || action?.escalation !== null) errors.push('plan proposal requires preference/escalation null')
  }
  if (action?.kind === 'life-escalation') {
    if (action?.preference !== null || action?.plan !== null) errors.push('life-escalation requires preference/plan null')
  }
  if (request?.hostRisk?.level === 'high') {
    if (action?.kind !== 'life-escalation') errors.push('high-risk Host classification requires life-escalation')
    if (action?.escalation?.required !== true) errors.push('high-risk escalation.required must be true')
  }
  const allowedLocators = new Set((request?.realtimeFacts || []).map(x => String(x.locator)))
  for (const citation of response?.citations || []) if (!allowedLocators.has(String(citation))) errors.push(`citation not present in Host realtime facts: ${citation}`)
  return { valid: errors.length === 0, errors }
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
