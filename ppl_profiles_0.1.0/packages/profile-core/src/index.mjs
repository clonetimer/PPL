import { createHash } from 'node:crypto'

export const PROFILE_SCHEMA = 'ppl.profile/0.1'
export const PROFILE_SNAPSHOT_SCHEMA = 'ppl.profile-snapshot/0.1'
export const PROFILE_RESOLUTION_SCHEMA = 'ppl.profile-resolution/0.1'
export const APP_SESSION_SCHEMA = 'ppl.app-session/0.2'

export const DEFAULT_COMMIT_END_REASONS = Object.freeze(['completed', 'max-tokens'])

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function fingerprintProfile(profile) {
  return createHash('sha256').update(stableStringify(profile)).digest('hex')
}

export function getPath(root, path) {
  if (!path) return root
  let value = root
  for (const key of path.split('.')) {
    if (!isRecord(value) && !Array.isArray(value)) return undefined
    value = value[key]
  }
  return value
}

export function setPath(root, path, value) {
  const keys = path.split('.')
  let cursor = root
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]
    if (!isRecord(cursor[key])) cursor[key] = {}
    cursor = cursor[key]
  }
  cursor[keys.at(-1)] = value
}

export function removePath(root, path) {
  const keys = path.split('.')
  let cursor = root
  for (let i = 0; i < keys.length - 1; i += 1) {
    cursor = cursor?.[keys[i]]
    if (!isRecord(cursor)) return
  }
  if (isRecord(cursor)) delete cursor[keys.at(-1)]
}

function compare(actual, operator, expected) {
  if (operator === 'eq') return Object.is(actual, expected)
  if (operator === 'neq') return !Object.is(actual, expected)
  if (operator === 'gt') return actual > expected
  if (operator === 'gte') return actual >= expected
  if (operator === 'lt') return actual < expected
  if (operator === 'lte') return actual <= expected
  if (operator === 'in') return Array.isArray(expected) && expected.some(item => Object.is(item, actual))
  if (operator === 'contains') return Array.isArray(actual) ? actual.includes(expected) : typeof actual === 'string' ? actual.includes(String(expected)) : false
  if (operator === 'exists') return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null
  throw new Error(`Unsupported condition operator: ${operator}`)
}

function resolveOperand(spec, env) {
  if (isRecord(spec) && typeof spec.from === 'string') return getPath(env, spec.from)
  return spec
}

export function matchCondition(condition, env) {
  if (!condition) return true
  if (Array.isArray(condition.all)) return condition.all.every(item => matchCondition(item, env))
  if (Array.isArray(condition.any)) return condition.any.some(item => matchCondition(item, env))
  if (condition.not) return !matchCondition(condition.not, env)
  const source = condition.source || 'state'
  const root = source === 'event' ? env.event : source === 'context' ? env.context : env.state
  const actual = getPath(root, condition.path || '')
  const operator = condition.op || 'eq'
  const expected = resolveOperand(condition.value, env)
  return compare(actual, operator, expected)
}

function clamp(value, min, max) {
  let next = value
  if (typeof min === 'number') next = Math.max(min, next)
  if (typeof max === 'number') next = Math.min(max, next)
  return next
}

function effectValue(effect, env) {
  if (effect.valueFrom) return getPath(env, effect.valueFrom)
  return clone(effect.value)
}

function applyEffect(state, effect, env) {
  const before = clone(getPath(state, effect.path))
  let after = before
  if (effect.op === 'set') {
    after = effectValue(effect, env)
    setPath(state, effect.path, clone(after))
  } else if (effect.op === 'add') {
    const delta = Number(effectValue(effect, env) ?? 0)
    const base = Number(before ?? 0)
    after = clamp(base + delta, effect.min, effect.max)
    setPath(state, effect.path, after)
  } else if (effect.op === 'multiply') {
    const factor = Number(effectValue(effect, env) ?? 1)
    const base = Number(before ?? 0)
    after = clamp(base * factor, effect.min, effect.max)
    setPath(state, effect.path, after)
  } else if (effect.op === 'max') {
    const candidate = Number(effectValue(effect, env))
    after = Math.max(Number(before ?? candidate), candidate)
    setPath(state, effect.path, after)
  } else if (effect.op === 'min') {
    const candidate = Number(effectValue(effect, env))
    after = Math.min(Number(before ?? candidate), candidate)
    setPath(state, effect.path, after)
  } else if (effect.op === 'appendUnique') {
    const value = effectValue(effect, env)
    const arr = Array.isArray(before) ? [...before] : []
    if (!arr.some(item => stableStringify(item) === stableStringify(value))) arr.push(clone(value))
    after = arr
    setPath(state, effect.path, arr)
  } else if (effect.op === 'removeValue') {
    const value = effectValue(effect, env)
    const arr = Array.isArray(before) ? [...before] : []
    after = arr.filter(item => stableStringify(item) !== stableStringify(value))
    setPath(state, effect.path, after)
  } else if (effect.op === 'remove') {
    after = undefined
    removePath(state, effect.path)
  } else {
    throw new Error(`Unsupported effect op: ${effect.op}`)
  }
  return { path: effect.path, op: effect.op, before, after: clone(after) }
}

function validateStateValue(spec, value, path, errors) {
  if (!spec) return
  if (spec.required && (value === undefined || value === null)) {
    errors.push(`state.${path} is required`)
    return
  }
  if (value === undefined || value === null) return
  if (spec.type === 'number' && typeof value !== 'number') errors.push(`state.${path} must be number`)
  if (spec.type === 'string' && typeof value !== 'string') errors.push(`state.${path} must be string`)
  if (spec.type === 'boolean' && typeof value !== 'boolean') errors.push(`state.${path} must be boolean`)
  if (spec.type === 'array' && !Array.isArray(value)) errors.push(`state.${path} must be array`)
  if (typeof value === 'number') {
    if (typeof spec.min === 'number' && value < spec.min) errors.push(`state.${path} < min ${spec.min}`)
    if (typeof spec.max === 'number' && value > spec.max) errors.push(`state.${path} > max ${spec.max}`)
  }
  if (Array.isArray(spec.enum) && !spec.enum.includes(value)) errors.push(`state.${path} is outside enum`)
}

export function validateProfile(profile) {
  const errors = []
  if (!isRecord(profile)) return ['profile must be an object']
  if (profile.schema !== PROFILE_SCHEMA) errors.push(`schema must equal ${PROFILE_SCHEMA}`)
  for (const key of ['id', 'version', 'kind']) if (typeof profile[key] !== 'string' || !profile[key]) errors.push(`${key} must be non-empty string`)
  if (!['character', 'tutor', 'research', 'life'].includes(profile.kind)) errors.push(`unsupported kind: ${profile.kind}`)
  for (const key of ['mission', 'initialState', 'stateSchema', 'transactionPolicy', 'evaluation', 'observability']) if (!isRecord(profile[key])) errors.push(`${key} must be object`)
  if (!Array.isArray(profile.rules)) errors.push('rules must be array')
  if (Array.isArray(profile.rules)) {
    const ids = new Set()
    profile.rules.forEach((rule, index) => {
      if (!isRecord(rule)) return errors.push(`rules[${index}] must be object`)
      if (typeof rule.id !== 'string' || !rule.id) errors.push(`rules[${index}].id missing`)
      if (ids.has(rule.id)) errors.push(`duplicate rule id: ${rule.id}`)
      ids.add(rule.id)
      if (!Array.isArray(rule.effects)) errors.push(`rule ${rule.id || index} effects must be array`)
    })
  }
  const commitReasons = profile.transactionPolicy?.commitEndReasons
  if (!Array.isArray(commitReasons) || !commitReasons.length) errors.push('transactionPolicy.commitEndReasons must be non-empty array')
  if (isRecord(profile.stateSchema) && isRecord(profile.initialState)) {
    for (const [path, spec] of Object.entries(profile.stateSchema)) validateStateValue(spec, getPath(profile.initialState, path), path, errors)
  }
  return errors
}

export function validateState(profile, state) {
  const errors = []
  if (!isRecord(state)) return ['state must be object']
  for (const [path, spec] of Object.entries(profile.stateSchema || {})) validateStateValue(spec, getPath(state, path), path, errors)
  return errors
}

export function evaluateProfile(profile, state, baseline = profile.initialState) {
  const metrics = []
  for (const metric of profile.evaluation?.metrics || []) {
    let value
    if (metric.type === 'path') value = getPath(state, metric.path)
    else if (metric.type === 'delta') {
      const current = Number(getPath(state, metric.path) ?? 0)
      const before = Number(getPath(baseline, metric.path) ?? 0)
      value = current - before
    } else if (metric.type === 'equals') value = Object.is(getPath(state, metric.path), metric.value)
    else if (metric.type === 'exists') {
      const current = getPath(state, metric.path)
      value = current !== undefined && current !== null
    }
    else if (metric.type === 'gte') value = Number(getPath(state, metric.path)) >= Number(metric.value)
    else if (metric.type === 'lte') value = Number(getPath(state, metric.path)) <= Number(metric.value)
    else throw new Error(`Unsupported evaluation metric type: ${metric.type}`)
    metrics.push({ id: metric.id, label: metric.label || metric.id, type: metric.type, path: metric.path, value, target: metric.target })
  }
  return { schema: 'ppl.profile-evaluation/0.1', metrics }
}

export function resolveProfileEvent(profile, baseState, event, context = {}) {
  const profileErrors = validateProfile(profile)
  if (profileErrors.length) throw new Error(`Invalid profile:\n${profileErrors.join('\n')}`)
  const stateErrors = validateState(profile, baseState)
  if (stateErrors.length) throw new Error(`Invalid base state:\n${stateErrors.join('\n')}`)
  if (!isRecord(event) || typeof event.type !== 'string' || !event.type) throw new Error('event.type is required')

  const resolvedState = clone(baseState)
  const activeRules = []
  const mutations = []
  const trace = {}
  const diagnostics = []
  const orderedRules = profile.rules.map((rule, index) => ({ rule, index })).sort((a, b) => {
    const priority = Number(b.rule.priority ?? 0) - Number(a.rule.priority ?? 0)
    return priority || a.index - b.index
  })

  for (const { rule } of orderedRules) {
    const env = { state: resolvedState, event, context }
    if (!matchCondition(rule.when, env)) continue
    activeRules.push({ id: rule.id, priority: rule.priority, rationale: rule.rationale })
    for (const diagnostic of rule.diagnostics || []) diagnostics.push({ rule: rule.id, ...clone(diagnostic) })
    for (const effect of rule.effects) {
      const step = applyEffect(resolvedState, effect, env)
      mutations.push({ source: rule.id, ...step })
      if (!trace[step.path]) trace[step.path] = { path: step.path, base: step.before, final: step.after, steps: [] }
      trace[step.path].final = step.after
      trace[step.path].steps.push({ rule: rule.id, priority: rule.priority, op: step.op, before: step.before, after: step.after })
    }
  }

  const resolvedErrors = validateState(profile, resolvedState)
  if (resolvedErrors.length) diagnostics.push({ severity: 'error', code: 'STATE_SCHEMA_VIOLATION', details: resolvedErrors })

  return {
    schema: PROFILE_RESOLUTION_SCHEMA,
    valid: resolvedErrors.length === 0,
    baseState: clone(baseState),
    resolvedState,
    activeRules,
    mutations,
    trace,
    diagnostics,
    evaluation: evaluateProfile(profile, resolvedState, profile.initialState),
  }
}

export function finalizeProfileResolution(profile, durableState, resolution, endReason) {
  const commitReasons = new Set(profile.transactionPolicy?.commitEndReasons || DEFAULT_COMMIT_END_REASONS)
  const committed = commitReasons.has(endReason) && resolution.valid !== false
  return {
    committed,
    status: committed ? 'applied' : 'discarded',
    state: committed ? clone(resolution.resolvedState) : clone(durableState),
  }
}

export function makeProfileSnapshot(profile, host, event, resolution, endReason) {
  const commitReasons = new Set(profile.transactionPolicy?.commitEndReasons || DEFAULT_COMMIT_END_REASONS)
  const committed = commitReasons.has(endReason) && resolution.valid !== false
  return {
    schema: PROFILE_SNAPSHOT_SCHEMA,
    profile: {
      id: profile.id,
      title: profile.title || profile.id,
      kind: profile.kind,
      version: profile.version,
      fingerprint: fingerprintProfile(profile),
    },
    host: { turn: host.turn, step: host.step ?? 1 },
    event: clone(event),
    resolution: clone(resolution),
    transaction: { endReason, status: committed ? 'applied' : 'discarded', committed },
  }
}

export function runProfileScenario(profile, scenario) {
  let state = clone(scenario.initialState || profile.initialState)
  const initialState = clone(state)
  const entries = []
  for (const [index, step] of (scenario.steps || []).entries()) {
    const host = { turn: step.turn ?? index + 1, step: step.step ?? 1 }
    const resolution = resolveProfileEvent(profile, state, step.event, step.context || {})
    const endReason = step.endReason || 'completed'
    const snapshot = makeProfileSnapshot(profile, host, step.event, resolution, endReason)
    const finalized = finalizeProfileResolution(profile, state, resolution, endReason)
    entries.push({ snapshotSeq: index + 1, kind: 'profile', endReason, snapshot })
    state = finalized.state
  }
  return {
    schema: 'ppl.profile-scenario-result/0.1',
    profile: { id: profile.id, kind: profile.kind, version: profile.version },
    scenario: scenario.id || 'scenario',
    initialState,
    finalState: clone(state),
    evaluation: evaluateProfile(profile, state, initialState),
    entries,
  }
}

export function toAppSession(profile, scenarioResult) {
  return {
    schema: APP_SESSION_SCHEMA,
    title: `${profile.title || profile.id} · ${scenarioResult.scenario}`,
    profile: { id: profile.id, title: profile.title || profile.id, kind: profile.kind, version: profile.version },
    observability: clone(profile.observability),
    entries: clone(scenarioResult.entries),
  }
}
