import crypto from 'node:crypto'

export const PPL_MAG_AGENT_CONTRACT_SCHEMA = 'ppl.multi-agent.agent-contract/0.1'
export const PPL_MAG_DELEGATION_DECISION_SCHEMA = 'ppl.multi-agent.delegation-decision/0.1'
export const PPL_MAG_CONTEXT_SCHEMA = 'ppl.multi-agent.context/0.1'
export const PPL_MAG_PROJECTION_SCHEMA = 'ppl.multi-agent.context-projection/0.1'
export const PPL_MAG_HANDOFF_SCHEMA = 'ppl.multi-agent.handoff/0.1'
export const PPL_MAG_FIDELITY_REPORT_SCHEMA = 'ppl.multi-agent.fidelity-report/0.1'
export const PPL_MAG_FIDELITY_BASELINE_SCHEMA = 'ppl.multi-agent.fidelity-baseline/0.1'
export const PPL_MAG_TRANSMISSION_LEDGER_SCHEMA = 'ppl.multi-agent.transmission-ledger/0.1'
export const PPL_MAG_SEMANTIC_JUDGE_REQUEST_SCHEMA = 'ppl.multi-agent.semantic-fidelity-judge-request/0.1'
export const PPL_MAG_SEMANTIC_JUDGE_RESULT_SCHEMA = 'ppl.multi-agent.semantic-fidelity-judge-result/0.1'
export const PPL_MAG_DELIVERY_JUDGE_REQUEST_SCHEMA = 'ppl.multi-agent.delivery-fidelity-judge-request/0.1'
export const PPL_MAG_DELIVERY_JUDGE_RESULT_SCHEMA = 'ppl.multi-agent.delivery-fidelity-judge-result/0.1'
export const PPL_MAG_FIDELITY_RECOVERY_PLAN_SCHEMA = 'ppl.multi-agent.fidelity-recovery-plan/0.1'
export const PPL_MAG_DELIVERY_BINDING_SCHEMA = 'ppl.multi-agent.delivery-evidence-binding/0.1'
export const PPL_MAG_BOUND_DELIVERY_JUDGE_REQUEST_SCHEMA = 'ppl.multi-agent.bound-delivery-fidelity-judge-request/0.1'
export const PPL_MAG_BOUND_DELIVERY_JUDGE_RESULT_SCHEMA = 'ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1'
export const PPL_MAG_GOVERNED_DELIVERY_SCHEMA = 'ppl.multi-agent.governed-delivery/0.1'

export const CLAIM_STATUSES = Object.freeze(['unknown', 'provisional', 'supported', 'confirmed', 'refuted'])
export const CLAIM_POLARITIES = Object.freeze(['support', 'oppose', 'neutral'])
export const SENSITIVITY_LEVELS = Object.freeze(['public', 'task', 'private', 'restricted'])
export const HANDOFF_TRANSFORM_MODES = Object.freeze(['verbatim', 'structured-summary', 'free-summary', 'delivery-synthesis'])
export const FIDELITY_SEVERITIES = Object.freeze(['info', 'warning', 'error'])

const STATUS_RANK = Object.freeze({ unknown: 0, provisional: 1, supported: 2, confirmed: 3, refuted: 3 })
const SENSITIVITY_RANK = Object.freeze({ public: 0, task: 1, private: 2, restricted: 3 })

function arr(value) { return Array.isArray(value) ? value : [] }
function uniq(value) { return [...new Set(arr(value).map(x => String(x ?? '').trim()).filter(Boolean))] }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }
function text(value) { return String(value ?? '').trim() }
function finite(value) { return typeof value === 'number' && Number.isFinite(value) }
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex') }
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}
function required(value, label, errors) { const out = text(value); if (!out) errors.push(`${label} required`); return out }
function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value) }
function subset(requested, allowed) { const set = new Set(allowed); return requested.every(x => set.has(x) || set.has('*')) }
function sameStringSet(a, b) { const aa = uniq(a).sort(); const bb = uniq(b).sort(); return aa.length === bb.length && aa.every((x, i) => x === bb[i]) }
function dotGet(obj, path) { let cur = obj; for (const part of path.split('.').filter(Boolean)) { if (!isObject(cur) && !Array.isArray(cur)) return undefined; cur = cur?.[part] } return cur }
function dotSet(obj, path, value) { const parts = path.split('.').filter(Boolean); let cur = obj; for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]; if (!isObject(cur[p])) cur[p] = {}; cur = cur[p] } if (parts.length) cur[parts.at(-1)] = clone(value) }
function normalizeClaim(claim = {}) {
  return {
    claimId: text(claim.claimId),
    canonicalText: text(claim.canonicalText),
    status: text(claim.status),
    polarity: text(claim.polarity),
    confidence: Number(claim.confidence),
    sourceRefs: uniq(claim.sourceRefs),
    assertedBy: text(claim.assertedBy),
    sensitivity: text(claim.sensitivity || 'task'),
    requiredForDecision: claim.requiredForDecision === true,
    conflictSetId: text(claim.conflictSetId) || null,
    derivedFrom: uniq(claim.derivedFrom),
    authorityScope: text(claim.authorityScope) || null,
    ...(text(claim.summary) ? { summary: text(claim.summary) } : {}),
  }
}

export function validateAgentContract(contract) {
  const errors = []
  if (!isObject(contract)) return { valid: false, errors: ['contract must be object'] }
  if (contract.schema !== PPL_MAG_AGENT_CONTRACT_SCHEMA) errors.push(`schema must be ${PPL_MAG_AGENT_CONTRACT_SCHEMA}`)
  required(contract.agentId, 'agentId', errors)
  required(contract.role, 'role', errors)
  if (!uniq(contract.authorityScopes).length) errors.push('authorityScopes required')
  if (!Array.isArray(contract.capabilities)) errors.push('capabilities must be array')
  if (!Array.isArray(contract.tools)) errors.push('tools must be array')
  if (!isObject(contract.delegation)) errors.push('delegation required')
  if (!Array.isArray(contract.delegation?.allowedTargets)) errors.push('delegation.allowedTargets must be array')
  if (!Number.isInteger(contract.delegation?.maxDepth) || contract.delegation.maxDepth < 0) errors.push('delegation.maxDepth must be non-negative integer')
  if (!Array.isArray(contract.delegation?.transferableAuthorityScopes)) errors.push('delegation.transferableAuthorityScopes must be array')
  if (!isObject(contract.contextPolicy)) errors.push('contextPolicy required')
  if (!Array.isArray(contract.contextPolicy?.allowedSensitivities)) errors.push('contextPolicy.allowedSensitivities must be array')
  for (const s of uniq(contract.contextPolicy?.allowedSensitivities)) if (!(s in SENSITIVITY_RANK)) errors.push(`unsupported sensitivity ${s}`)
  if (!Array.isArray(contract.contextPolicy?.allowedStatePaths)) errors.push('contextPolicy.allowedStatePaths must be array')
  return { valid: errors.length === 0, errors }
}

export function compileGovernance(contracts = []) {
  const agents = new Map()
  for (const contract of arr(contracts)) {
    const check = validateAgentContract(contract)
    if (!check.valid) throw new Error(`Invalid agent contract: ${check.errors.join('; ')}`)
    if (agents.has(contract.agentId)) throw new Error(`Duplicate agentId: ${contract.agentId}`)
    agents.set(contract.agentId, clone(contract))
  }
  return Object.freeze({ agents })
}

export function evaluateDelegation(governance, request = {}) {
  const violations = []
  const source = governance?.agents?.get?.(text(request.sourceAgentId))
  const target = governance?.agents?.get?.(text(request.targetAgentId))
  if (!source) violations.push({ code: 'SOURCE_AGENT_UNKNOWN', severity: 'error' })
  if (!target) violations.push({ code: 'TARGET_AGENT_UNKNOWN', severity: 'error' })
  if (!source || !target) return delegationDecision(request, violations)

  const delegation = source.delegation || {}
  const allowedTargets = uniq(delegation.allowedTargets)
  if (!(allowedTargets.includes('*') || allowedTargets.includes(target.agentId))) violations.push({ code: 'DELEGATION_TARGET_NOT_ALLOWED', severity: 'error' })
  const chain = uniq(request.chain)
  const depth = Number.isInteger(request.depth) ? request.depth : chain.length
  if (depth > delegation.maxDepth) violations.push({ code: 'DELEGATION_DEPTH_EXCEEDED', severity: 'error', details: { depth, maxDepth: delegation.maxDepth } })
  if (source.agentId === target.agentId && delegation.allowSelfDelegation !== true) violations.push({ code: 'SELF_DELEGATION_NOT_ALLOWED', severity: 'error' })
  if (chain.includes(target.agentId) && delegation.allowCycles !== true) violations.push({ code: 'DELEGATION_CYCLE_DETECTED', severity: 'error', details: { chain, target: target.agentId } })

  const requestedCapabilities = uniq(request.requestedCapabilities)
  if (!subset(requestedCapabilities, uniq(target.capabilities))) violations.push({ code: 'TARGET_CAPABILITY_MISMATCH', severity: 'error', details: { requestedCapabilities } })
  const requestedTools = uniq(request.requestedTools)
  if (!subset(requestedTools, uniq(target.tools))) violations.push({ code: 'TARGET_TOOL_MISMATCH', severity: 'error', details: { requestedTools } })

  const requestedAuthorityScopes = uniq(request.requestedAuthorityScopes)
  const sourceScopes = uniq(source.authorityScopes)
  const transferable = uniq(delegation.transferableAuthorityScopes)
  const targetScopes = uniq(target.authorityScopes)
  if (!subset(requestedAuthorityScopes, sourceScopes)) violations.push({ code: 'SOURCE_AUTHORITY_ESCALATION', severity: 'error', details: { requestedAuthorityScopes } })
  if (!subset(requestedAuthorityScopes, transferable)) violations.push({ code: 'AUTHORITY_NOT_DELEGABLE', severity: 'error', details: { requestedAuthorityScopes } })
  if (!subset(requestedAuthorityScopes, targetScopes)) violations.push({ code: 'TARGET_AUTHORITY_MISMATCH', severity: 'error', details: { requestedAuthorityScopes } })

  return delegationDecision(request, violations, { source, target })
}

function delegationDecision(request, violations, resolved = {}) {
  const allowed = violations.every(v => v.severity !== 'error')
  return {
    schema: PPL_MAG_DELEGATION_DECISION_SCHEMA,
    decisionId: `delegation_${sha256({ request, violations }).slice(0, 20)}`,
    allowed,
    sourceAgentId: text(request.sourceAgentId),
    targetAgentId: text(request.targetAgentId),
    taskId: text(request.taskId),
    violations,
    granted: allowed ? {
      capabilities: uniq(request.requestedCapabilities),
      tools: uniq(request.requestedTools),
      authorityScopes: uniq(request.requestedAuthorityScopes),
      maxSensitivity: maxAllowedSensitivity(resolved.target?.contextPolicy?.allowedSensitivities),
    } : null,
  }
}

function maxAllowedSensitivity(levels) {
  const values = uniq(levels).filter(x => x in SENSITIVITY_RANK)
  if (!values.length) return null
  return values.sort((a, b) => SENSITIVITY_RANK[b] - SENSITIVITY_RANK[a])[0]
}

export function validateContext(context) {
  const errors = []
  if (!isObject(context)) return { valid: false, errors: ['context must be object'] }
  if (context.schema !== PPL_MAG_CONTEXT_SCHEMA) errors.push(`schema must be ${PPL_MAG_CONTEXT_SCHEMA}`)
  if (!isObject(context.state)) errors.push('state must be object')
  if (!Array.isArray(context.claims)) errors.push('claims must be array')
  const ids = new Set()
  for (const raw of arr(context.claims)) {
    const c = normalizeClaim(raw)
    if (!c.claimId) errors.push('claimId required')
    else if (ids.has(c.claimId)) errors.push(`duplicate claimId ${c.claimId}`)
    ids.add(c.claimId)
    if (!c.canonicalText) errors.push(`claim ${c.claimId || '?'} canonicalText required`)
    if (!CLAIM_STATUSES.includes(c.status)) errors.push(`claim ${c.claimId || '?'} status invalid`)
    if (!CLAIM_POLARITIES.includes(c.polarity)) errors.push(`claim ${c.claimId || '?'} polarity invalid`)
    if (!finite(c.confidence) || c.confidence < 0 || c.confidence > 1) errors.push(`claim ${c.claimId || '?'} confidence invalid`)
    if (!c.sourceRefs.length) errors.push(`claim ${c.claimId || '?'} sourceRefs required`)
    if (!c.assertedBy) errors.push(`claim ${c.claimId || '?'} assertedBy required`)
    if (!SENSITIVITY_LEVELS.includes(c.sensitivity)) errors.push(`claim ${c.claimId || '?'} sensitivity invalid`)
  }
  return { valid: errors.length === 0, errors }
}

export function projectContext(governance, input = {}) {
  const target = governance?.agents?.get?.(text(input.targetAgentId))
  if (!target) throw new Error(`Unknown target agent: ${input.targetAgentId}`)
  const check = validateContext(input.context)
  if (!check.valid) throw new Error(`Invalid context: ${check.errors.join('; ')}`)
  const policy = target.contextPolicy
  const allowedSensitivities = new Set(uniq(policy.allowedSensitivities))
  const requiredClaimIds = new Set(uniq(input.requiredClaimIds))
  const allowedClaimIds = new Set(uniq(input.allowedClaimIds))
  const denyClaimIds = new Set(uniq(input.denyClaimIds))
  const includedClaims = []
  const droppedClaims = []
  const blockingViolations = []

  for (const raw of input.context.claims) {
    const claim = normalizeClaim(raw)
    let include = allowedSensitivities.has(claim.sensitivity)
    if (allowedClaimIds.size) include = include && allowedClaimIds.has(claim.claimId)
    if (denyClaimIds.has(claim.claimId)) include = false
    if (include) includedClaims.push(claim)
    else droppedClaims.push({ claimId: claim.claimId, reason: 'projection-policy' })
    if (!include && (claim.requiredForDecision || requiredClaimIds.has(claim.claimId))) {
      blockingViolations.push({ code: 'REQUIRED_CLAIM_NOT_PROJECTABLE', severity: 'error', claimId: claim.claimId })
    }
  }

  if (policy.preserveConflictSets !== false) {
    const sourceSets = groupConflictSets(input.context.claims)
    const projectedIds = new Set(includedClaims.map(c => c.claimId))
    for (const [setId, claims] of sourceSets.entries()) {
      // Conflict preservation is a hard evidence-integrity rule. An explicit
      // allowedClaimIds selector cannot be used to whitelist only one side of
      // an otherwise projectable material conflict. denyClaimIds remains an
      // explicit policy prohibition and is therefore excluded from eligibility.
      const eligible = claims.filter(c => allowedSensitivities.has(c.sensitivity) && !denyClaimIds.has(c.claimId))
      const included = eligible.filter(c => projectedIds.has(c.claimId))
      if (eligible.length >= 2 && included.length > 0 && included.length < eligible.length) {
        blockingViolations.push({ code: 'CONFLICT_SET_PARTIAL_PROJECTION', severity: 'error', conflictSetId: setId, missingClaimIds: eligible.filter(c => !projectedIds.has(c.claimId)).map(c => c.claimId) })
      }
    }
  }

  const projectedState = {}
  const allowedStatePaths = uniq(policy.allowedStatePaths)
  for (const path of allowedStatePaths) {
    const value = dotGet(input.context.state, path)
    if (value !== undefined) dotSet(projectedState, path, value)
  }

  const projection = {
    schema: PPL_MAG_PROJECTION_SCHEMA,
    projectionId: `projection_${sha256({ target: target.agentId, state: projectedState, claims: includedClaims }).slice(0, 20)}`,
    targetAgentId: target.agentId,
    sourceContextHash: sha256(input.context),
    state: projectedState,
    claims: includedClaims,
    droppedClaims,
    violations: blockingViolations,
    allowed: blockingViolations.length === 0,
  }
  projection.projectedHash = sha256({ state: projection.state, claims: projection.claims })
  return projection
}

function groupConflictSets(claims) {
  const map = new Map()
  for (const raw of arr(claims)) {
    const claim = normalizeClaim(raw)
    if (!claim.conflictSetId) continue
    if (!map.has(claim.conflictSetId)) map.set(claim.conflictSetId, [])
    map.get(claim.conflictSetId).push(claim)
  }
  return map
}

export function buildHandoffEnvelope(input = {}) {
  if (input.delegationDecision?.allowed !== true) throw new Error('handoff requires allowed delegation decision')
  if (input.projection?.allowed !== true) throw new Error('handoff requires allowed context projection')
  const mode = text(input.transform?.mode || 'verbatim')
  if (!HANDOFF_TRANSFORM_MODES.includes(mode)) throw new Error(`unsupported transform mode ${mode}`)
  const claims = arr(input.projection.claims).map(normalizeClaim)
  const envelope = {
    schema: PPL_MAG_HANDOFF_SCHEMA,
    handoffId: `handoff_${sha256({ delegation: input.delegationDecision.decisionId, projection: input.projection.projectionId, task: input.task, transform: { mode, summary: text(input.transform?.summary) || null } }).slice(0, 20)}`,
    sourceAgentId: input.delegationDecision.sourceAgentId,
    targetAgentId: input.delegationDecision.targetAgentId,
    taskId: input.delegationDecision.taskId,
    task: clone(input.task || {}),
    delegationDecisionId: input.delegationDecision.decisionId,
    projectionId: input.projection.projectionId,
    sourceContextHash: input.projection.sourceContextHash,
    projectedHash: input.projection.projectedHash,
    transform: {
      mode,
      semanticFidelityRequired: mode !== 'verbatim',
      summary: text(input.transform?.summary) || null,
    },
    payload: {
      state: clone(input.projection.state),
      claims,
    },
    claimManifest: claims.map(c => ({
      claimId: c.claimId,
      canonicalHash: sha256(c.canonicalText),
      status: c.status,
      polarity: c.polarity,
      confidence: c.confidence,
      sourceRefs: c.sourceRefs,
      assertedBy: c.assertedBy,
      sensitivity: c.sensitivity,
      requiredForDecision: c.requiredForDecision,
      conflictSetId: c.conflictSetId,
      authorityScope: c.authorityScope,
    })),
  }
  envelope.taskHash = sha256(envelope.task)
  envelope.payloadHash = sha256(envelope.payload)
  return envelope
}

export function assessInformationFidelity(input = {}) {
  const handoff = input.handoff
  if (!handoff || handoff.schema !== PPL_MAG_HANDOFF_SCHEMA) throw new Error('valid handoff required')
  const received = input.receivedContext
  const check = validateContext(received)
  if (!check.valid) throw new Error(`Invalid received context: ${check.errors.join('; ')}`)
  const findings = []
  const expectedClaims = new Map(arr(handoff.payload?.claims).map(c => [c.claimId, normalizeClaim(c)]))
  const receivedClaims = new Map(arr(received.claims).map(c => [c.claimId, normalizeClaim(c)]))
  const tolerance = finite(input.confidenceTolerance) ? input.confidenceTolerance : 0.05

  if (input.receivedTask === undefined) add(findings, 'TASK_FIDELITY_EVIDENCE_MISSING', 'error', {})
  else if (sha256(input.receivedTask) !== handoff.taskHash) add(findings, 'TASK_MUTATION', 'error', { expectedTaskHash: handoff.taskHash, receivedTaskHash: sha256(input.receivedTask) })

  for (const [id, source] of expectedClaims) {
    const target = receivedClaims.get(id)
    if (!target) {
      add(findings, source.requiredForDecision ? 'REQUIRED_CLAIM_OMISSION' : 'CLAIM_OMISSION', source.requiredForDecision ? 'error' : 'warning', { claimId: id })
      continue
    }
    if (source.canonicalText !== target.canonicalText) add(findings, 'CANONICAL_CLAIM_MUTATION', 'error', { claimId: id })
    if (source.polarity !== target.polarity) add(findings, 'POLARITY_FLIP', 'error', { claimId: id, from: source.polarity, to: target.polarity })
    if (statusEscalated(source.status, target.status)) add(findings, 'STATUS_ESCALATION', 'error', { claimId: id, from: source.status, to: target.status })
    if (target.confidence - source.confidence > tolerance) add(findings, 'CONFIDENCE_INFLATION', 'error', { claimId: id, from: source.confidence, to: target.confidence })
    const missingRefs = source.sourceRefs.filter(ref => !target.sourceRefs.includes(ref))
    if (missingRefs.length) add(findings, 'PROVENANCE_LOSS', 'error', { claimId: id, missingRefs })
    if (source.assertedBy !== target.assertedBy) add(findings, 'ATTRIBUTION_SWAP', 'error', { claimId: id, from: source.assertedBy, to: target.assertedBy })
    if (source.authorityScope !== target.authorityScope) add(findings, 'AUTHORITY_SCOPE_MUTATION', 'error', { claimId: id, from: source.authorityScope, to: target.authorityScope })
    if (source.sensitivity !== target.sensitivity) add(findings, 'SENSITIVITY_MUTATION', 'error', { claimId: id, from: source.sensitivity, to: target.sensitivity })
    if (source.requiredForDecision !== target.requiredForDecision) add(findings, 'DECISION_REQUIREMENT_MUTATION', 'error', { claimId: id, from: source.requiredForDecision, to: target.requiredForDecision })
    if (source.conflictSetId !== target.conflictSetId) add(findings, 'CONFLICT_SET_MUTATION', 'error', { claimId: id, from: source.conflictSetId, to: target.conflictSetId })
    if (!sameStringSet(source.derivedFrom, target.derivedFrom)) add(findings, 'DERIVATION_MUTATION', 'error', { claimId: id, from: source.derivedFrom, to: target.derivedFrom })
    const injectedRefs = target.sourceRefs.filter(ref => !source.sourceRefs.includes(ref))
    if (injectedRefs.length) add(findings, 'PROVENANCE_INJECTION', 'error', { claimId: id, injectedRefs })
  }

  for (const [id, target] of receivedClaims) {
    if (expectedClaims.has(id)) continue
    if (!target.derivedFrom.length || !target.derivedFrom.every(parent => expectedClaims.has(parent))) add(findings, 'UNSUPPORTED_SYNTHESIS', 'error', { claimId: id, derivedFrom: target.derivedFrom })
    else add(findings, 'UNVALIDATED_DERIVED_CLAIM', 'error', { claimId: id, derivedFrom: target.derivedFrom })
  }

  const expectedSets = groupConflictSets([...expectedClaims.values()])
  for (const [setId, claims] of expectedSets) {
    if (claims.length < 2) continue
    const expectedIds = claims.map(c => c.claimId)
    const receivedIds = expectedIds.filter(id => receivedClaims.has(id))
    if (receivedIds.length > 0 && receivedIds.length < expectedIds.length) add(findings, 'COUNTER_EVIDENCE_ERASURE', 'error', { conflictSetId: setId, missingClaimIds: expectedIds.filter(id => !receivedClaims.has(id)) })
  }

  const expectedPaths = flattenPaths(handoff.payload?.state || {})
  const receivedPaths = flattenPaths(received.state || {})
  const contamination = receivedPaths.filter(p => !expectedPaths.includes(p))
  if (contamination.length) add(findings, 'CONTEXT_CONTAMINATION', 'error', { statePaths: contamination })

  const requiredSemanticJudge = handoff.transform?.semanticFidelityRequired === true
  const errors = findings.filter(f => f.severity === 'error')
  const report = {
    schema: PPL_MAG_FIDELITY_REPORT_SCHEMA,
    handoffId: handoff.handoffId,
    passed: errors.length === 0,
    hardGatePassed: errors.length === 0,
    semanticFidelityRequired: requiredSemanticJudge,
    semanticFidelityStatus: requiredSemanticJudge ? 'pending' : 'not-required',
    findings,
    metrics: {
      expectedClaims: expectedClaims.size,
      receivedClaims: receivedClaims.size,
      retainedClaims: [...expectedClaims.keys()].filter(id => receivedClaims.has(id)).length,
      claimRetentionRatio: expectedClaims.size ? [...expectedClaims.keys()].filter(id => receivedClaims.has(id)).length / expectedClaims.size : 1,
      errorCount: errors.length,
      warningCount: findings.filter(f => f.severity === 'warning').length,
      taskFidelityVerified: input.receivedTask !== undefined,
    },
  }
  return report
}

function statusEscalated(from, to) {
  if (from === 'refuted' && to !== 'refuted') return true
  if (to === 'refuted' && from !== 'refuted') return false
  return (STATUS_RANK[to] ?? 99) > (STATUS_RANK[from] ?? -1)
}
function flattenPaths(value, prefix = '') {
  const out = []
  if (!isObject(value)) return prefix ? [prefix] : []
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isObject(child)) out.push(...flattenPaths(child, path))
    else out.push(path)
  }
  return out.sort()
}
function add(findings, code, severity, details = {}) { findings.push({ code, severity, details }) }



export function buildFidelityBaseline(context, options = {}) {
  const check = validateContext(context)
  if (!check.valid) throw new Error(`Invalid context: ${check.errors.join('; ')}`)
  const tracked = new Set(uniq(options.trackedClaimIds))
  const claims = context.claims.map(normalizeClaim).filter(c => !tracked.size || tracked.has(c.claimId))
  return {
    schema: PPL_MAG_FIDELITY_BASELINE_SCHEMA,
    baselineId: `fidelity_baseline_${sha256({ context, tracked: [...tracked].sort() }).slice(0, 20)}`,
    rootContextHash: sha256(context),
    trackedClaims: claims,
    createdAt: options.createdAt || new Date().toISOString(),
  }
}

export function assessCumulativeFidelity(input = {}) {
  const baseline = input.baseline
  if (!baseline || baseline.schema !== PPL_MAG_FIDELITY_BASELINE_SCHEMA) throw new Error('valid fidelity baseline required')
  const received = input.receivedContext
  const check = validateContext(received)
  if (!check.valid) throw new Error(`Invalid received context: ${check.errors.join('; ')}`)
  const tolerance = finite(input.confidenceTolerance) ? input.confidenceTolerance : 0.05
  const sourceClaims = new Map(arr(baseline.trackedClaims).map(c => [c.claimId, normalizeClaim(c)]))
  const receivedClaims = new Map(arr(received.claims).map(c => [c.claimId, normalizeClaim(c)]))
  const findings = []
  for (const [id, source] of sourceClaims) {
    const target = receivedClaims.get(id)
    if (!target) {
      if (source.requiredForDecision) add(findings, 'CUMULATIVE_REQUIRED_CLAIM_OMISSION', 'error', { claimId: id })
      continue
    }
    if (source.canonicalText !== target.canonicalText) add(findings, 'CUMULATIVE_CANONICAL_CLAIM_MUTATION', 'error', { claimId: id })
    if (source.polarity !== target.polarity) add(findings, 'CUMULATIVE_POLARITY_FLIP', 'error', { claimId: id, from: source.polarity, to: target.polarity })
    if (statusEscalated(source.status, target.status)) add(findings, 'CUMULATIVE_STATUS_ESCALATION', 'error', { claimId: id, from: source.status, to: target.status })
    if (target.confidence - source.confidence > tolerance) add(findings, 'CUMULATIVE_CONFIDENCE_INFLATION', 'error', { claimId: id, root: source.confidence, downstream: target.confidence })
    const missingRefs = source.sourceRefs.filter(ref => !target.sourceRefs.includes(ref))
    if (missingRefs.length) add(findings, 'CUMULATIVE_PROVENANCE_LOSS', 'error', { claimId: id, missingRefs })
    if (source.assertedBy !== target.assertedBy) add(findings, 'CUMULATIVE_ATTRIBUTION_SWAP', 'error', { claimId: id, from: source.assertedBy, to: target.assertedBy })
    if (source.authorityScope !== target.authorityScope) add(findings, 'CUMULATIVE_AUTHORITY_SCOPE_MUTATION', 'error', { claimId: id, from: source.authorityScope, to: target.authorityScope })
    if (source.sensitivity !== target.sensitivity) add(findings, 'CUMULATIVE_SENSITIVITY_MUTATION', 'error', { claimId: id, from: source.sensitivity, to: target.sensitivity })
    if (source.requiredForDecision !== target.requiredForDecision) add(findings, 'CUMULATIVE_DECISION_REQUIREMENT_MUTATION', 'error', { claimId: id, from: source.requiredForDecision, to: target.requiredForDecision })
    if (source.conflictSetId !== target.conflictSetId) add(findings, 'CUMULATIVE_CONFLICT_SET_MUTATION', 'error', { claimId: id, from: source.conflictSetId, to: target.conflictSetId })
    if (!sameStringSet(source.derivedFrom, target.derivedFrom)) add(findings, 'CUMULATIVE_DERIVATION_MUTATION', 'error', { claimId: id, from: source.derivedFrom, to: target.derivedFrom })
    const injectedRefs = target.sourceRefs.filter(ref => !source.sourceRefs.includes(ref))
    if (injectedRefs.length) add(findings, 'CUMULATIVE_PROVENANCE_INJECTION', 'error', { claimId: id, injectedRefs })
  }
  const rootConflictSets = groupConflictSets([...sourceClaims.values()])
  for (const [setId, claims] of rootConflictSets) {
    if (claims.length < 2) continue
    const present = claims.filter(c => receivedClaims.has(c.claimId))
    if (present.length > 0 && present.length < claims.length) add(findings, 'CUMULATIVE_COUNTER_EVIDENCE_ERASURE', 'error', { conflictSetId: setId, missingClaimIds: claims.filter(c => !receivedClaims.has(c.claimId)).map(c => c.claimId) })
  }
  return {
    schema: PPL_MAG_FIDELITY_REPORT_SCHEMA,
    reportKind: 'cumulative',
    baselineId: baseline.baselineId,
    passed: findings.every(f => f.severity !== 'error'),
    hardGatePassed: findings.every(f => f.severity !== 'error'),
    semanticFidelityRequired: false,
    semanticFidelityStatus: 'not-applicable',
    findings,
    metrics: {
      trackedClaims: sourceClaims.size,
      retainedClaims: [...sourceClaims.keys()].filter(id => receivedClaims.has(id)).length,
      errorCount: findings.filter(f => f.severity === 'error').length,
    },
  }
}

export function createTransmissionLedger(input = {}) {
  const traceId = text(input.traceId) || `mag_trace_${sha256({ rootContextHash: input.baseline?.rootContextHash, startedAt: input.startedAt || '' }).slice(0, 20)}`
  return {
    schema: PPL_MAG_TRANSMISSION_LEDGER_SCHEMA,
    traceId,
    baselineId: input.baseline?.baselineId || null,
    rootContextHash: input.baseline?.rootContextHash || null,
    hops: [],
    startedAt: input.startedAt || new Date().toISOString(),
  }
}

export function appendTransmissionHop(ledger, input = {}) {
  if (!ledger || ledger.schema !== PPL_MAG_TRANSMISSION_LEDGER_SCHEMA) throw new Error('valid transmission ledger required')
  if (!input.handoff || input.handoff.schema !== PPL_MAG_HANDOFF_SCHEMA) throw new Error('valid handoff required')
  if (!input.fidelityReport || input.fidelityReport.schema !== PPL_MAG_FIDELITY_REPORT_SCHEMA) throw new Error('valid fidelity report required')
  const out = clone(ledger)
  const previous = out.hops.at(-1)
  if (previous && previous.targetAgentId !== input.handoff.sourceAgentId) throw new Error('handoff chain discontinuity')
  out.hops.push({
    hop: out.hops.length + 1,
    handoffId: input.handoff.handoffId,
    sourceAgentId: input.handoff.sourceAgentId,
    targetAgentId: input.handoff.targetAgentId,
    payloadHash: input.handoff.payloadHash,
    fidelityPassed: input.fidelityReport.passed === true,
    findingCodes: arr(input.fidelityReport.findings).map(f => f.code),
  })
  out.lastUpdatedAt = input.at || new Date().toISOString()
  out.passed = out.hops.every(h => h.fidelityPassed)
  return out
}

export function buildSemanticFidelityJudgeRequest(input = {}) {
  const handoff = input.handoff
  if (!handoff || handoff.schema !== PPL_MAG_HANDOFF_SCHEMA) throw new Error('valid handoff required')
  if (!['structured-summary', 'free-summary'].includes(handoff.transform?.mode)) throw new Error('semantic fidelity judge only applies to summary transforms')
  const transmittedSummary = text(input.transmittedSummary || handoff.transform?.summary)
  if (!transmittedSummary) throw new Error('transmittedSummary required')
  return {
    schema: PPL_MAG_SEMANTIC_JUDGE_REQUEST_SCHEMA,
    requestId: `fidelity_judge_${sha256({ handoffId: handoff.handoffId, transmittedSummary }).slice(0, 20)}`,
    handoffId: handoff.handoffId,
    originalClaims: clone(handoff.payload.claims),
    transmittedSummary,
    contract: {
      mustPreserve: ['material-claims', 'counter-evidence', 'uncertainty', 'attribution', 'provenance-meaning'],
      mustNotIntroduce: ['new-facts', 'confidence-upgrades', 'consensus-not-supported-by-source'],
      outputSchema: PPL_MAG_SEMANTIC_JUDGE_RESULT_SCHEMA,
    },
  }
}

export function validateSemanticFidelityJudgeResult(result) {
  const errors = []
  if (!isObject(result)) return { valid: false, errors: ['result must be object'] }
  if (result.schema !== PPL_MAG_SEMANTIC_JUDGE_RESULT_SCHEMA) errors.push(`schema must be ${PPL_MAG_SEMANTIC_JUDGE_RESULT_SCHEMA}`)
  required(result.handoffId, 'handoffId', errors)
  for (const key of ['pass', 'claimPreservation', 'counterEvidencePreservation', 'uncertaintyPreservation', 'attributionPreservation', 'noNovelClaims']) {
    if (typeof result[key] !== 'boolean') errors.push(`${key} must be boolean`)
  }
  if (!Array.isArray(result.findings)) errors.push('findings must be array')
  return { valid: errors.length === 0, errors }
}

export function finalizeFidelityAssessment(structuralReport, semanticJudgeResult = null) {
  if (!structuralReport || structuralReport.schema !== PPL_MAG_FIDELITY_REPORT_SCHEMA) throw new Error('structural fidelity report required')
  if (!structuralReport.semanticFidelityRequired) return clone(structuralReport)
  if (!semanticJudgeResult) return { ...clone(structuralReport), passed: false, semanticFidelityStatus: 'missing', findings: [...structuralReport.findings, { code: 'SEMANTIC_FIDELITY_EVIDENCE_MISSING', severity: 'error', details: {} }] }
  const check = validateSemanticFidelityJudgeResult(semanticJudgeResult)
  if (!check.valid) throw new Error(`Invalid semantic fidelity judge result: ${check.errors.join('; ')}`)
  if (semanticJudgeResult.handoffId !== structuralReport.handoffId) throw new Error('semantic fidelity handoffId mismatch')
  const semanticPass = semanticJudgeResult.pass === true && semanticJudgeResult.claimPreservation === true && semanticJudgeResult.counterEvidencePreservation === true && semanticJudgeResult.uncertaintyPreservation === true && semanticJudgeResult.attributionPreservation === true && semanticJudgeResult.noNovelClaims === true
  return {
    ...clone(structuralReport),
    passed: structuralReport.hardGatePassed && semanticPass,
    semanticFidelityStatus: semanticPass ? 'pass' : 'fail',
    semanticJudgeResult: clone(semanticJudgeResult),
    findings: semanticPass ? clone(structuralReport.findings) : [...clone(structuralReport.findings), { code: 'SEMANTIC_FIDELITY_JUDGE_FAIL', severity: 'error', details: { findings: semanticJudgeResult.findings } }],
  }
}



export function buildDeliveryFidelityJudgeRequest(input = {}) {
  const handoff = input.handoff
  if (!handoff || handoff.schema !== PPL_MAG_HANDOFF_SCHEMA) throw new Error('valid handoff required')
  if (handoff.transform?.mode !== 'delivery-synthesis') throw new Error('delivery fidelity judge requires delivery-synthesis transform')
  const transmittedAnswer = text(input.transmittedAnswer || handoff.transform?.summary)
  if (!transmittedAnswer) throw new Error('transmittedAnswer required')
  return {
    schema: PPL_MAG_DELIVERY_JUDGE_REQUEST_SCHEMA,
    requestId: `delivery_fidelity_judge_${sha256({ handoffId: handoff.handoffId, transmittedAnswer }).slice(0, 20)}`,
    handoffId: handoff.handoffId,
    objective: clone(handoff.task || {}),
    originalClaims: clone(handoff.payload.claims),
    transmittedAnswer,
    contract: {
      mustPreserve: ['material-claims', 'counter-evidence', 'uncertainty', 'attribution-meaning', 'provenance-meaning'],
      mayIntroduce: ['traceable-derived-conclusion'],
      mustNotIntroduce: ['new-source-facts', 'confidence-upgrades', 'unsupported-consensus'],
      conclusionMustBeSupportedBy: 'originalClaims',
      outputSchema: PPL_MAG_DELIVERY_JUDGE_RESULT_SCHEMA,
    },
  }
}

export function validateDeliveryFidelityJudgeResult(result) {
  const errors = []
  if (!isObject(result)) return { valid: false, errors: ['result must be object'] }
  if (result.schema !== PPL_MAG_DELIVERY_JUDGE_RESULT_SCHEMA) errors.push(`schema must be ${PPL_MAG_DELIVERY_JUDGE_RESULT_SCHEMA}`)
  required(result.handoffId, 'handoffId', errors)
  for (const key of ['pass', 'claimPreservation', 'counterEvidencePreservation', 'uncertaintyPreservation', 'attributionPreservation', 'conclusionSupported', 'noNovelFacts']) {
    if (typeof result[key] !== 'boolean') errors.push(`${key} must be boolean`)
  }
  if (!Array.isArray(result.findings)) errors.push('findings must be array')
  return { valid: errors.length === 0, errors }
}

export function finalizeDeliveryFidelityAssessment(structuralReport, deliveryJudgeResult = null) {
  if (!structuralReport || structuralReport.schema !== PPL_MAG_FIDELITY_REPORT_SCHEMA) throw new Error('structural fidelity report required')
  if (!deliveryJudgeResult) return { ...clone(structuralReport), passed: false, semanticFidelityStatus: 'missing', findings: [...structuralReport.findings, { code: 'DELIVERY_FIDELITY_EVIDENCE_MISSING', severity: 'error', details: {} }] }
  const check = validateDeliveryFidelityJudgeResult(deliveryJudgeResult)
  if (!check.valid) throw new Error(`Invalid delivery fidelity judge result: ${check.errors.join('; ')}`)
  if (deliveryJudgeResult.handoffId !== structuralReport.handoffId) throw new Error('delivery fidelity handoffId mismatch')
  const deliveryPass = deliveryJudgeResult.pass === true && deliveryJudgeResult.claimPreservation === true && deliveryJudgeResult.counterEvidencePreservation === true && deliveryJudgeResult.uncertaintyPreservation === true && deliveryJudgeResult.attributionPreservation === true && deliveryJudgeResult.conclusionSupported === true && deliveryJudgeResult.noNovelFacts === true
  return {
    ...clone(structuralReport),
    passed: structuralReport.hardGatePassed && deliveryPass,
    semanticFidelityStatus: deliveryPass ? 'pass' : 'fail',
    deliveryJudgeResult: clone(deliveryJudgeResult),
    findings: deliveryPass ? clone(structuralReport.findings) : [...clone(structuralReport.findings), { code: 'DELIVERY_FIDELITY_JUDGE_FAIL', severity: 'error', details: { findings: deliveryJudgeResult.findings } }],
  }
}


export function buildDeliveryEvidenceBinding(input = {}) {
  const handoff = input.handoff
  if (!handoff || handoff.schema !== PPL_MAG_HANDOFF_SCHEMA) throw new Error('valid handoff required')
  if (handoff.transform?.mode !== 'delivery-synthesis') throw new Error('delivery evidence binding requires delivery-synthesis transform')
  const claims = arr(handoff.payload?.claims).map(normalizeClaim)
  if (!claims.length) throw new Error('delivery evidence binding requires claims')
  const claimMap = new Map(claims.map(c => [c.claimId, c]))
  const parentClaimIds = uniq(input.parentClaimIds)
  if (!parentClaimIds.length) throw new Error('parentClaimIds required')
  for (const claimId of parentClaimIds) if (!claimMap.has(claimId)) throw new Error(`unknown parent claim ${claimId}`)
  const requiredIds = claims.filter(c => c.requiredForDecision).map(c => c.claimId)
  const missingRequired = requiredIds.filter(id => !parentClaimIds.includes(id))
  if (missingRequired.length) throw new Error(`parentClaimIds missing required claims: ${missingRequired.join(',')}`)
  const conclusionText = text(input.derivedConclusion ?? handoff.transform?.summary)
  if (!conclusionText) throw new Error('derivedConclusion required')
  const evidence = parentClaimIds.map(claimId => {
    const c = claimMap.get(claimId)
    return {
      claimId: c.claimId,
      canonicalText: c.canonicalText,
      status: c.status,
      polarity: c.polarity,
      confidence: c.confidence,
      sourceRefs: clone(c.sourceRefs),
      assertedBy: c.assertedBy,
      requiredForDecision: c.requiredForDecision,
      conflictSetId: c.conflictSetId,
    }
  })
  return {
    schema: PPL_MAG_DELIVERY_BINDING_SCHEMA,
    bindingId: `delivery_binding_${sha256({ handoffId: handoff.handoffId, evidence, conclusionText, parentClaimIds }).slice(0, 20)}`,
    handoffId: handoff.handoffId,
    objective: clone(handoff.task || {}),
    evidence,
    derivedConclusion: { text: conclusionText, parentClaimIds },
    canonicalEvidenceHash: sha256(evidence.map(e => ({ claimId: e.claimId, canonicalText: e.canonicalText, sourceRefs: e.sourceRefs, assertedBy: e.assertedBy }))),
  }
}

export function validateDeliveryEvidenceBinding(binding, handoff = null) {
  const errors = []
  if (!isObject(binding)) return { valid: false, errors: ['binding must be object'] }
  if (binding.schema !== PPL_MAG_DELIVERY_BINDING_SCHEMA) errors.push(`schema must be ${PPL_MAG_DELIVERY_BINDING_SCHEMA}`)
  required(binding.bindingId, 'bindingId', errors)
  required(binding.handoffId, 'handoffId', errors)
  if (!Array.isArray(binding.evidence) || !binding.evidence.length) errors.push('evidence must be non-empty array')
  const ids = new Set()
  for (const e of arr(binding.evidence)) {
    const id = required(e.claimId, 'evidence.claimId', errors)
    required(e.canonicalText, 'evidence.canonicalText', errors)
    if (ids.has(id)) errors.push(`duplicate evidence claim ${id}`)
    ids.add(id)
    if (!Array.isArray(e.sourceRefs)) errors.push(`evidence ${id} sourceRefs must be array`)
  }
  if (!isObject(binding.derivedConclusion)) errors.push('derivedConclusion required')
  const conclusion = text(binding.derivedConclusion?.text)
  if (!conclusion) errors.push('derivedConclusion.text required')
  const parents = uniq(binding.derivedConclusion?.parentClaimIds)
  if (!parents.length) errors.push('derivedConclusion.parentClaimIds required')
  for (const id of parents) if (!ids.has(id)) errors.push(`derived conclusion parent ${id} missing from evidence`)
  if (handoff) {
    if (handoff.schema !== PPL_MAG_HANDOFF_SCHEMA) errors.push('handoff must be valid handoff')
    else {
      if (binding.handoffId !== handoff.handoffId) errors.push('binding handoffId mismatch')
      const sourceMap = new Map(arr(handoff.payload?.claims).map(c => { const n = normalizeClaim(c); return [n.claimId, n] }))
      for (const e of arr(binding.evidence)) {
        const src = sourceMap.get(text(e.claimId))
        if (!src) { errors.push(`binding evidence claim ${text(e.claimId)} not present in handoff`); continue }
        if (text(e.canonicalText) !== src.canonicalText) errors.push(`canonical evidence mutation for ${src.claimId}`)
        if (!sameStringSet(e.sourceRefs, src.sourceRefs)) errors.push(`evidence provenance mutation for ${src.claimId}`)
        if (text(e.assertedBy) !== src.assertedBy) errors.push(`evidence attribution mutation for ${src.claimId}`)
      }
      const requiredIds = [...sourceMap.values()].filter(c => c.requiredForDecision).map(c => c.claimId)
      for (const id of requiredIds) if (!parents.includes(id)) errors.push(`derived conclusion missing required parent ${id}`)
    }
  }
  return { valid: errors.length === 0, errors }
}

export function buildBoundDeliveryFidelityJudgeRequest(input = {}) {
  const handoff = input.handoff
  const binding = input.binding
  const check = validateDeliveryEvidenceBinding(binding, handoff)
  if (!check.valid) throw new Error(`Invalid delivery evidence binding: ${check.errors.join('; ')}`)
  return {
    schema: PPL_MAG_BOUND_DELIVERY_JUDGE_REQUEST_SCHEMA,
    requestId: `bound_delivery_fidelity_judge_${sha256({ bindingId: binding.bindingId, conclusion: binding.derivedConclusion.text }).slice(0, 20)}`,
    handoffId: binding.handoffId,
    bindingId: binding.bindingId,
    objective: clone(binding.objective || {}),
    canonicalEvidence: clone(binding.evidence),
    derivedConclusion: clone(binding.derivedConclusion),
    contract: {
      evidenceIsCanonicalAndNotModelEditable: true,
      mustPreserve: ['material-counter-evidence', 'uncertainty', 'attribution-meaning', 'metric-and-scope-boundaries'],
      mayIntroduce: ['traceable-derived-conclusion'],
      mustNotIntroduce: ['new-source-facts', 'metric-scope-broadening', 'confidence-upgrades', 'unsupported-consensus'],
      conclusionMustBeSupportedBy: 'derivedConclusion.parentClaimIds',
      outputSchema: PPL_MAG_BOUND_DELIVERY_JUDGE_RESULT_SCHEMA,
    },
  }
}

export function validateBoundDeliveryFidelityJudgeResult(result) {
  const errors = []
  if (!isObject(result)) return { valid: false, errors: ['result must be object'] }
  if (result.schema !== PPL_MAG_BOUND_DELIVERY_JUDGE_RESULT_SCHEMA) errors.push(`schema must be ${PPL_MAG_BOUND_DELIVERY_JUDGE_RESULT_SCHEMA}`)
  required(result.handoffId, 'handoffId', errors)
  required(result.bindingId, 'bindingId', errors)
  for (const key of ['pass', 'counterEvidenceIntegrated', 'uncertaintyCalibrated', 'attributionPreservation', 'metricScopePreservation', 'conclusionSupported', 'noNovelFacts']) {
    if (typeof result[key] !== 'boolean') errors.push(`${key} must be boolean`)
  }
  if (!Array.isArray(result.findings)) errors.push('findings must be array')
  return { valid: errors.length === 0, errors }
}

export function finalizeBoundDeliveryFidelityAssessment(structuralReport, binding, deliveryJudgeResult = null) {
  if (!structuralReport || structuralReport.schema !== PPL_MAG_FIDELITY_REPORT_SCHEMA) throw new Error('structural fidelity report required')
  const bindingCheck = validateDeliveryEvidenceBinding(binding)
  if (!bindingCheck.valid) throw new Error(`Invalid delivery evidence binding: ${bindingCheck.errors.join('; ')}`)
  if (!deliveryJudgeResult) return { ...clone(structuralReport), passed: false, semanticFidelityStatus: 'missing', findings: [...structuralReport.findings, { code: 'BOUND_DELIVERY_FIDELITY_EVIDENCE_MISSING', severity: 'error', details: {} }] }
  const check = validateBoundDeliveryFidelityJudgeResult(deliveryJudgeResult)
  if (!check.valid) throw new Error(`Invalid bound delivery fidelity judge result: ${check.errors.join('; ')}`)
  if (deliveryJudgeResult.handoffId !== structuralReport.handoffId || deliveryJudgeResult.handoffId !== binding.handoffId) throw new Error('bound delivery handoffId mismatch')
  if (deliveryJudgeResult.bindingId !== binding.bindingId) throw new Error('bound delivery bindingId mismatch')
  const deliveryPass = deliveryJudgeResult.pass === true && deliveryJudgeResult.counterEvidenceIntegrated === true && deliveryJudgeResult.uncertaintyCalibrated === true && deliveryJudgeResult.attributionPreservation === true && deliveryJudgeResult.metricScopePreservation === true && deliveryJudgeResult.conclusionSupported === true && deliveryJudgeResult.noNovelFacts === true
  return {
    ...clone(structuralReport),
    passed: structuralReport.hardGatePassed && deliveryPass,
    semanticFidelityStatus: deliveryPass ? 'pass' : 'fail',
    deliveryBinding: clone(binding),
    deliveryJudgeResult: clone(deliveryJudgeResult),
    findings: deliveryPass ? clone(structuralReport.findings) : [...clone(structuralReport.findings), { code: 'BOUND_DELIVERY_FIDELITY_JUDGE_FAIL', severity: 'error', details: { findings: deliveryJudgeResult.findings } }],
  }
}

export function renderGovernedDelivery(input = {}) {
  const binding = input.binding
  const check = validateDeliveryEvidenceBinding(binding, input.handoff || null)
  if (!check.valid) throw new Error(`Invalid delivery evidence binding: ${check.errors.join('; ')}`)
  const evidenceLines = binding.evidence.map(e => `- ${e.canonicalText}`)
  const renderedText = `Evidence:\n${evidenceLines.join('\n')}\n\nConclusion:\n${binding.derivedConclusion.text}`
  return {
    schema: PPL_MAG_GOVERNED_DELIVERY_SCHEMA,
    deliveryId: `governed_delivery_${sha256({ bindingId: binding.bindingId, renderedText }).slice(0, 20)}`,
    bindingId: binding.bindingId,
    handoffId: binding.handoffId,
    renderedText,
    evidenceCount: binding.evidence.length,
    parentClaimIds: clone(binding.derivedConclusion.parentClaimIds),
  }
}

export function buildFidelityRecoveryPlan(input = {}) {
  const handoff = input.handoff
  if (!handoff || handoff.schema !== PPL_MAG_HANDOFF_SCHEMA) throw new Error('valid handoff required')
  const structuralReport = input.structuralReport
  if (!structuralReport || structuralReport.schema !== PPL_MAG_FIDELITY_REPORT_SCHEMA) throw new Error('structural fidelity report required')
  const findings = arr(input.judgeResult?.findings).map(text).filter(Boolean)
  const mode = handoff.transform?.mode
  let strategy = 'block'
  let recoverable = false
  if (structuralReport.hardGatePassed === true && ['structured-summary', 'free-summary'].includes(mode)) {
    strategy = 'verbatim-fallback'
    recoverable = true
  } else if (structuralReport.hardGatePassed === true && mode === 'delivery-synthesis') {
    strategy = 'regenerate-delivery'
    recoverable = true
  }
  return {
    schema: PPL_MAG_FIDELITY_RECOVERY_PLAN_SCHEMA,
    planId: `fidelity_recovery_${sha256({ handoffId: handoff.handoffId, strategy, findings }).slice(0, 20)}`,
    handoffId: handoff.handoffId,
    transformMode: mode,
    recoverable,
    strategy,
    maxAttempts: recoverable ? 1 : 0,
    immutableClaims: clone(handoff.payload?.claims || []),
    task: clone(handoff.task || {}),
    judgeFindings: findings,
    constraints: recoverable ? [
      'Preserve canonical claim meaning, material counter-evidence, uncertainty, attribution, and provenance meaning.',
      'Do not add source facts, confidence upgrades, or unsupported consensus.',
      ...(mode === 'delivery-synthesis' ? ['A derived conclusion is allowed only when directly supported by the supplied claims and must remain calibrated to unresolved conflict.'] : ['Do not transmit the rejected summary; fall back to the canonical projected payload.']),
    ] : ['Block delivery because deterministic hard gates failed or no safe recovery exists.'],
  }
}

export function buildGovernedHandoff(governance, input = {}) {
  const delegationDecision = evaluateDelegation(governance, input.delegation)
  if (!delegationDecision.allowed) return { allowed: false, phase: 'delegation', delegationDecision }
  const projection = projectContext(governance, {
    targetAgentId: delegationDecision.targetAgentId,
    context: input.context,
    requiredClaimIds: input.requiredClaimIds,
    allowedClaimIds: input.allowedClaimIds,
    denyClaimIds: input.denyClaimIds,
  })
  if (!projection.allowed) return { allowed: false, phase: 'projection', delegationDecision, projection }
  const handoff = buildHandoffEnvelope({ delegationDecision, projection, task: input.task, transform: input.transform })
  return { allowed: true, phase: 'handoff', delegationDecision, projection, handoff }
}

export function fingerprint(value) { return sha256(value) }
