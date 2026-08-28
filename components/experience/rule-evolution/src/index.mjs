import crypto from 'node:crypto'

export const PPL_EXPERIENCE_RULE_SCHEMA = 'ppl.experience-rule/0.1'
export const PPL_EXPERIENCE_RULE_CAPSULE_SCHEMA = 'ppl.experience-rule-capsule/0.1'
export const PPL_EXPERIENCE_EVALUATION_SCHEMA = 'ppl.experience-evaluation/0.2'
export const PPL_EXPERIENCE_CANDIDATE_SCHEMA = 'ppl.experience-candidate/0.2'
export const PPL_EXPERIENCE_EVOLUTION_LEDGER_SCHEMA = 'ppl.experience-evolution-ledger/0.2'
export const PPL_EXPERIENCE_PROMOTION_POLICY_SCHEMA = 'ppl.experience-promotion-policy/0.2'
export const PPL_EXPERIENCE_PROMOTION_REVIEW_SCHEMA = 'ppl.experience-promotion-review/0.2'

export const EXPERIENCE_RULE_MODES = Object.freeze(['off', 'observe', 'evaluation', 'enforce'])
export const EXPERIENCE_EVIDENCE_CLASSES = Object.freeze(['synthetic', 'real-replay', 'fault-injection', 'real-soak', 'manual-review'])
export const EXPERIENCE_CANDIDATE_LIFECYCLES = Object.freeze(['candidate', 'qualified', 'validated', 'superseded', 'retired', 'rolled-back'])
export const EXPERIENCE_PROMOTION_RISK_CLASSES = Object.freeze(['L0', 'L1', 'L2', 'L3'])

const STATUSES = new Set(['candidate', 'validated', 'retired'])
const PHASES = new Set(['pre-judge'])
const EFFECTS = new Set(['retry-with-host-owned-repair'])
const DIRECTIONS = new Set(['maximize', 'minimize'])
const CANDIDATE_LIFECYCLES = new Set(EXPERIENCE_CANDIDATE_LIFECYCLES)
const EVIDENCE_CLASSES = new Set(EXPERIENCE_EVIDENCE_CLASSES)
const RISK_CLASSES = new Set(EXPERIENCE_PROMOTION_RISK_CLASSES)
const TRANSITIONS = Object.freeze({
  candidate: new Set(['qualified', 'retired']),
  qualified: new Set(['candidate', 'validated', 'retired', 'rolled-back']),
  validated: new Set(['superseded', 'retired', 'rolled-back']),
  superseded: new Set(['validated', 'retired']),
  retired: new Set([]),
  'rolled-back': new Set([]),
})

function arr(value) { return Array.isArray(value) ? value : [] }
function uniqStrings(value) { return [...new Set(arr(value).map(x => String(x ?? '').trim()).filter(Boolean))] }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex') }
function isFiniteNumber(value) { return typeof value === 'number' && Number.isFinite(value) }
function isSha256(value) { return /^[a-f0-9]{64}$/iu.test(String(value || '')) }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function requiredString(value, label, errors) {
  const out = String(value ?? '').trim()
  if (!out) errors.push(`${label} required`)
  return out
}
function normalizeHardGateEntry(value) {
  if (typeof value === 'boolean') return { passed: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return {
    passed: value.passed === true,
    ...(isFiniteNumber(value.count) ? { count: value.count } : {}),
    ...(String(value.details || '').trim() ? { details: String(value.details).trim() } : {}),
  }
}
function normalizedImprovement(candidate, baseline, direction) {
  const raw = direction === 'maximize' ? candidate - baseline : baseline - candidate
  const denominator = Math.max(Math.abs(candidate), Math.abs(baseline), 1)
  return raw / denominator
}

// ---------------------------------------------------------------------------
// 0.1 Stable runtime contract (backward compatible)
// ---------------------------------------------------------------------------

export function validateExperienceRule(rule) {
  const errors = []
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return { valid: false, errors: ['rule must be object'] }
  if (rule.schema !== PPL_EXPERIENCE_RULE_SCHEMA) errors.push(`schema must be ${PPL_EXPERIENCE_RULE_SCHEMA}`)
  if (!/^rule_[a-z0-9_]+$/u.test(String(rule.ruleId || ''))) errors.push('ruleId invalid')
  if (!String(rule.version || '').trim()) errors.push('version required')
  if (!STATUSES.has(String(rule.status || ''))) errors.push('status invalid')
  if (!['tutor', 'research', 'life', 'shared'].includes(String(rule.domain || ''))) errors.push('domain invalid')
  if (!rule.activation || typeof rule.activation !== 'object') errors.push('activation required')
  if (String(rule.activation?.detector || '') !== 'host-deterministic-policy-code') errors.push('activation.detector must be host-deterministic-policy-code')
  const codes = uniqStrings(rule.activation?.policyCodes)
  if (!codes.length) errors.push('activation.policyCodes required')
  if (!rule.action || typeof rule.action !== 'object') errors.push('action required')
  if (!PHASES.has(String(rule.action?.phase || ''))) errors.push('action.phase invalid')
  if (!EFFECTS.has(String(rule.action?.effect || ''))) errors.push('action.effect invalid')
  if (rule.action?.skipJudgeOnMatchedDraft !== true) errors.push('action.skipJudgeOnMatchedDraft must be true')
  if (!rule.authority || rule.authority?.precedence !== 'below-host-policy') errors.push('authority.precedence must be below-host-policy')
  const forbidden = uniqStrings(rule.authority?.mustNotOverride)
  for (const required of ['response-contract', 'profile-policy', 'durable-state', 'judge-on-unknown-failures']) {
    if (!forbidden.includes(required)) errors.push(`authority.mustNotOverride missing ${required}`)
  }
  if (!rule.provenance || typeof rule.provenance !== 'object') errors.push('provenance required')
  if (!uniqStrings(rule.provenance?.evidenceSha256).length) errors.push('provenance.evidenceSha256 required')
  return { valid: errors.length === 0, errors }
}

export function normalizeExperienceRuleMode(mode = 'off') {
  const value = String(mode || 'off')
  if (!EXPERIENCE_RULE_MODES.includes(value)) throw new Error(`Unsupported experience rule mode: ${value}`)
  return value
}

export function prepareExperienceRules(rules = [], mode = 'off') {
  const normalizedMode = normalizeExperienceRuleMode(mode)
  const prepared = []
  for (const input of arr(rules)) {
    const check = validateExperienceRule(input)
    if (!check.valid) throw new Error(`Invalid experience rule: ${check.errors.join('; ')}`)
    const rule = clone(input)
    if (rule.status === 'retired') continue
    if (normalizedMode === 'enforce' && rule.status !== 'validated') throw new Error(`Enforce mode requires validated rule: ${rule.ruleId}`)
    prepared.push(rule)
  }
  return Object.freeze({ mode: normalizedMode, rules: Object.freeze(prepared) })
}

export function evaluatePreJudgeExperienceRules(preparedOrRules, judgeRequest, options = {}) {
  const prepared = preparedOrRules?.mode ? preparedOrRules : prepareExperienceRules(preparedOrRules, options.mode || 'off')
  const deterministic = arr(judgeRequest?.deterministicViolations)
  const role = String(judgeRequest?.modelRole || '')
  const matches = []
  for (const rule of prepared.rules) {
    if (rule.domain !== 'shared' && rule.domain !== role) continue
    const codes = new Set(uniqStrings(rule.activation?.policyCodes))
    const violations = deterministic.filter(v => codes.has(String(v?.code || '')))
    if (!violations.length) continue
    matches.push({
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      ruleStatus: rule.status,
      violations: clone(violations),
    })
  }
  const enforce = prepared.mode === 'evaluation' || prepared.mode === 'enforce'
  const violations = []
  const seen = new Set()
  if (enforce) {
    for (const match of matches) for (const violation of match.violations) {
      const key = `${violation.code}:${violation.evidenceQuote || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      violations.push({ ...violation, experienceRuleIds: matches.filter(m => m.violations.some(v => v.code === violation.code)).map(m => m.ruleId) })
    }
  }
  return {
    mode: prepared.mode,
    matched: matches.length > 0,
    enforced: enforce && violations.length > 0,
    matches,
    violations,
    skipJudge: enforce && violations.some(v => String(v.severity || '') === 'error'),
  }
}

export function distillDeterministicFastPathCandidate(input = {}) {
  const total = Number(input.totalRecords || 0)
  const structurallyValid = Number(input.structurallyValidRecords ?? total)
  const targetMatches = Number(input.targetPolicyCodeMatches || 0)
  const code = String(input.policyCode || '').trim()
  const domain = String(input.domain || '').trim()
  const evidenceSha256 = uniqStrings(input.evidenceSha256)
  if (!total || !structurallyValid || !code || !domain || !evidenceSha256.length) throw new Error('insufficient distillation input')
  const coverage = targetMatches / structurallyValid
  const minCoverage = Number(input.minimumCoverage ?? 0.80)
  if (coverage < minCoverage) throw new Error(`target deterministic coverage ${coverage.toFixed(4)} below minimum ${minCoverage.toFixed(4)}`)
  const slug = code.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_|_$/gu, '')
  const rule = {
    schema: PPL_EXPERIENCE_RULE_SCHEMA,
    ruleId: `rule_${slug}_prejudge_fastpath`,
    version: String(input.version || '0.1.0-candidate.1'),
    status: 'candidate',
    domain,
    summary: String(input.summary || `Repeated real failures are already covered by Host deterministic policy code ${code}; retry locally before invoking the external Judge.`),
    activation: { detector: 'host-deterministic-policy-code', policyCodes: [code] },
    action: { phase: 'pre-judge', effect: 'retry-with-host-owned-repair', skipJudgeOnMatchedDraft: true, repairCompiler: 'compileRetryRequest' },
    authority: { precedence: 'below-host-policy', mustNotOverride: ['response-contract', 'profile-policy', 'durable-state', 'judge-on-unknown-failures'] },
    provenance: {
      sourceKind: 'real-execution-replay', evidenceSha256, totalRecords: total,
      structurallyValidRecords: structurallyValid, targetPolicyCodeMatches: targetMatches,
      deterministicCoverage: Number(coverage.toFixed(6)), distilledAt: input.distilledAt || new Date().toISOString(),
    },
  }
  const check = validateExperienceRule(rule)
  if (!check.valid) throw new Error(check.errors.join('; '))
  return rule
}

export function buildExperienceRuleCapsule(input = {}) {
  const ruleCheck = validateExperienceRule(input.rule)
  if (!ruleCheck.valid) throw new Error(`invalid rule: ${ruleCheck.errors.join('; ')}`)
  const replay = input.replay || {}
  if (replay.realEvidence !== true) throw new Error('capsule requires real evidence replay')
  if (!Number.isInteger(replay.totalRecords) || replay.totalRecords < 1) throw new Error('capsule replay.totalRecords required')
  if (!Array.isArray(replay.artifacts) || replay.artifacts.length < 1) throw new Error('capsule replay artifacts required')
  return {
    schema: PPL_EXPERIENCE_RULE_CAPSULE_SCHEMA,
    capsuleId: `capsule_${sha256({ rule: input.rule.ruleId, replay }).slice(0, 20)}`,
    rule: { ruleId: input.rule.ruleId, version: input.rule.version, status: input.rule.status },
    outcome: clone(input.outcome || {}), replay: clone(replay), createdAt: input.createdAt || new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// 0.2 Evolution governance contracts (EvoX-inspired, PPL-authority constrained)
// ---------------------------------------------------------------------------

export function validateExperienceEvaluation(evaluation) {
  const errors = []
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) return { valid: false, errors: ['evaluation must be object'] }
  if (evaluation.schema !== PPL_EXPERIENCE_EVALUATION_SCHEMA) errors.push(`schema must be ${PPL_EXPERIENCE_EVALUATION_SCHEMA}`)
  requiredString(evaluation.evaluationId, 'evaluationId', errors)
  if (!evaluation.asset || typeof evaluation.asset !== 'object') errors.push('asset required')
  requiredString(evaluation.asset?.assetType, 'asset.assetType', errors)
  requiredString(evaluation.asset?.assetId, 'asset.assetId', errors)
  requiredString(evaluation.asset?.version, 'asset.version', errors)
  if (!EVIDENCE_CLASSES.has(String(evaluation.evidenceClass || ''))) errors.push('evidenceClass invalid')
  if (!Number.isInteger(evaluation.sampleCount) || evaluation.sampleCount < 1) errors.push('sampleCount must be positive integer')
  const evidenceHashes = uniqStrings(evaluation.evidenceSha256)
  if (!evidenceHashes.length) errors.push('evidenceSha256 required')
  if (evidenceHashes.some(x => !isSha256(x))) errors.push('evidenceSha256 must contain SHA-256 hex strings')
  const gateEntries = Object.entries(evaluation.hardGates || {})
  if (!gateEntries.length) errors.push('hardGates required')
  for (const [id, value] of gateEntries) {
    if (!String(id).trim()) errors.push('hardGate id invalid')
    if (!value || typeof value !== 'object' || typeof value.passed !== 'boolean') errors.push(`hardGate ${id} invalid`)
  }
  const metricEntries = Object.entries(evaluation.metrics || {})
  if (!metricEntries.length) errors.push('metrics required')
  for (const [metric, value] of metricEntries) {
    if (!String(metric).trim()) errors.push('metric id invalid')
    if (!value || typeof value !== 'object') { errors.push(`metric ${metric} invalid`); continue }
    if (!DIRECTIONS.has(String(value.direction || ''))) errors.push(`metric ${metric}.direction invalid`)
    if (!isFiniteNumber(value.candidate)) errors.push(`metric ${metric}.candidate must be finite number`)
    if (!isFiniteNumber(value.baseline)) errors.push(`metric ${metric}.baseline must be finite number`)
  }
  if (!Array.isArray(evaluation.findings)) errors.push('findings must be array')
  return { valid: errors.length === 0, errors }
}

export function buildExperienceEvaluation(input = {}) {
  const asset = {
    assetType: String(input.asset?.assetType || 'rule').trim(),
    assetId: String(input.asset?.assetId || '').trim(),
    version: String(input.asset?.version || '').trim(),
  }
  const evidenceClass = String(input.evidenceClass || '').trim()
  const sampleCount = Number(input.sampleCount || 0)
  const evidenceSha256 = uniqStrings(input.evidenceSha256)
  const hardGates = {}
  for (const [id, value] of Object.entries(input.hardGates || {})) {
    const normalized = normalizeHardGateEntry(value)
    if (normalized) hardGates[String(id).trim()] = normalized
  }
  const metrics = {}
  for (const [id, value] of Object.entries(input.metrics || {})) {
    metrics[String(id).trim()] = {
      direction: String(value?.direction || '').trim(),
      candidate: Number(value?.candidate),
      baseline: Number(value?.baseline),
      ...(String(value?.unit || '').trim() ? { unit: String(value.unit).trim() } : {}),
    }
  }
  const identityInput = { asset, evidenceClass, sampleCount, evidenceSha256, hardGates, metrics }
  const evaluation = {
    schema: PPL_EXPERIENCE_EVALUATION_SCHEMA,
    evaluationId: String(input.evaluationId || `eval_${sha256(identityInput).slice(0, 20)}`),
    asset, evidenceClass, sampleCount, evidenceSha256, hardGates, metrics,
    findings: arr(input.findings).map(x => String(x)),
    createdAt: input.createdAt || new Date().toISOString(),
  }
  const check = validateExperienceEvaluation(evaluation)
  if (!check.valid) throw new Error(`Invalid experience evaluation: ${check.errors.join('; ')}`)
  return evaluation
}

export function aggregateExperienceEvaluations(evaluations = [], options = {}) {
  const excluded = new Set(uniqStrings(options.excludeEvidenceClasses))
  const source = arr(evaluations).filter(e => !excluded.has(String(e?.evidenceClass || '')))
  if (!source.length) throw new Error('No eligible experience evaluations')
  for (const evaluation of source) {
    const check = validateExperienceEvaluation(evaluation)
    if (!check.valid) throw new Error(`Invalid experience evaluation: ${check.errors.join('; ')}`)
  }
  const firstAsset = source[0].asset
  for (const evaluation of source) {
    if (evaluation.asset.assetType !== firstAsset.assetType || evaluation.asset.assetId !== firstAsset.assetId || evaluation.asset.version !== firstAsset.version) {
      throw new Error('All evaluations must target the same asset version')
    }
  }
  const hardGates = {}
  const metricAcc = new Map()
  const evidenceClasses = new Set()
  const evidenceSha256 = new Set()
  let totalSamples = 0
  for (const evaluation of source) {
    const weight = evaluation.sampleCount
    totalSamples += weight
    evidenceClasses.add(evaluation.evidenceClass)
    for (const hash of evaluation.evidenceSha256) evidenceSha256.add(hash)
    for (const [id, gate] of Object.entries(evaluation.hardGates)) {
      const current = hardGates[id] || { passed: true, observed: 0, failed: 0, count: 0 }
      current.observed += 1
      current.passed = current.passed && gate.passed
      if (!gate.passed) current.failed += 1
      if (isFiniteNumber(gate.count)) current.count += gate.count
      hardGates[id] = current
    }
    for (const [id, metric] of Object.entries(evaluation.metrics)) {
      const current = metricAcc.get(id) || { direction: metric.direction, candidateWeighted: 0, baselineWeighted: 0, samples: 0, unit: metric.unit }
      if (current.direction !== metric.direction) throw new Error(`Metric direction mismatch: ${id}`)
      current.candidateWeighted += metric.candidate * weight
      current.baselineWeighted += metric.baseline * weight
      current.samples += weight
      metricAcc.set(id, current)
    }
  }
  const metrics = {}
  for (const [id, value] of metricAcc.entries()) {
    metrics[id] = {
      direction: value.direction,
      candidate: value.candidateWeighted / value.samples,
      baseline: value.baselineWeighted / value.samples,
      coverageSamples: value.samples,
      ...(value.unit ? { unit: value.unit } : {}),
    }
  }
  return {
    asset: clone(firstAsset),
    evaluationCount: source.length,
    totalSamples,
    evidenceClasses: [...evidenceClasses].sort(),
    evidenceSha256: [...evidenceSha256].sort(),
    hardGates,
    metrics,
  }
}

export function buildPromotionPolicy(input = {}) {
  const riskClass = String(input.riskClass || 'L1')
  if (!RISK_CLASSES.has(riskClass)) throw new Error(`Unsupported promotion risk class: ${riskClass}`)
  const objectives = arr(input.objectives).map((objective, index) => {
    const metric = String(objective?.metric || '').trim()
    const direction = String(objective?.direction || '').trim()
    const weight = Number(objective?.weight ?? 1)
    const maxRegressionNormalized = Number(objective?.maxRegressionNormalized ?? 0)
    if (!metric) throw new Error(`objective[${index}].metric required`)
    if (!DIRECTIONS.has(direction)) throw new Error(`objective ${metric}.direction invalid`)
    if (!isFiniteNumber(weight) || weight <= 0) throw new Error(`objective ${metric}.weight invalid`)
    if (!isFiniteNumber(maxRegressionNormalized) || maxRegressionNormalized < 0) throw new Error(`objective ${metric}.maxRegressionNormalized invalid`)
    return { metric, direction, weight, maxRegressionNormalized }
  })
  if (!objectives.length) throw new Error('promotion policy objectives required')
  const policy = {
    schema: PPL_EXPERIENCE_PROMOTION_POLICY_SCHEMA,
    policyId: String(input.policyId || `policy_${sha256({ riskClass, objectives }).slice(0, 20)}`),
    riskClass,
    requiredHardGates: uniqStrings(input.requiredHardGates),
    requiredEvidenceClasses: uniqStrings(input.requiredEvidenceClasses),
    excludedEvidenceClasses: uniqStrings(input.excludedEvidenceClasses ?? ['synthetic']),
    minimumTotalSamples: Number(input.minimumTotalSamples ?? 1),
    minimumFitness: Number(input.minimumFitness ?? 0),
    requireAnyImprovement: input.requireAnyImprovement === true,
    humanApprovalRequired: input.humanApprovalRequired ?? ['L2', 'L3'].includes(riskClass),
    objectives,
    convergence: {
      patience: Number(input.convergence?.patience ?? 3),
      minImprovement: Number(input.convergence?.minImprovement ?? 0.01),
    },
  }
  if (!Number.isInteger(policy.minimumTotalSamples) || policy.minimumTotalSamples < 1) throw new Error('minimumTotalSamples must be positive integer')
  if (!isFiniteNumber(policy.minimumFitness)) throw new Error('minimumFitness invalid')
  if (!Number.isInteger(policy.convergence.patience) || policy.convergence.patience < 1) throw new Error('convergence.patience invalid')
  if (!isFiniteNumber(policy.convergence.minImprovement) || policy.convergence.minImprovement < 0) throw new Error('convergence.minImprovement invalid')
  return policy
}

export function reviewPromotionCandidate(evaluations = [], policyInput = {}, options = {}) {
  const policy = buildPromotionPolicy(policyInput)
  const aggregate = aggregateExperienceEvaluations(evaluations, { excludeEvidenceClasses: policy.excludedEvidenceClasses })
  const reasons = []
  const hardGateResults = {}
  for (const gateId of policy.requiredHardGates) {
    const gate = aggregate.hardGates[gateId]
    const passed = Boolean(gate?.passed)
    hardGateResults[gateId] = { passed, observed: gate?.observed || 0, failed: gate?.failed || 0, count: gate?.count || 0 }
    if (!gate) reasons.push(`required hard gate missing: ${gateId}`)
    else if (!passed) reasons.push(`required hard gate failed: ${gateId}`)
  }
  for (const evidenceClass of policy.requiredEvidenceClasses) {
    if (!aggregate.evidenceClasses.includes(evidenceClass)) reasons.push(`required evidence class missing: ${evidenceClass}`)
  }
  if (aggregate.totalSamples < policy.minimumTotalSamples) reasons.push(`sample count ${aggregate.totalSamples} below minimum ${policy.minimumTotalSamples}`)

  const objectiveResults = []
  let weightedScore = 0
  let weightTotal = 0
  let anyImprovement = false
  for (const objective of policy.objectives) {
    const metric = aggregate.metrics[objective.metric]
    if (!metric) {
      reasons.push(`required objective metric missing: ${objective.metric}`)
      objectiveResults.push({ ...objective, passed: false, missing: true })
      continue
    }
    if (metric.direction !== objective.direction) {
      reasons.push(`objective direction mismatch: ${objective.metric}`)
      objectiveResults.push({ ...objective, passed: false, directionMismatch: true })
      continue
    }
    const improvementNormalized = normalizedImprovement(metric.candidate, metric.baseline, objective.direction)
    const passed = improvementNormalized >= -objective.maxRegressionNormalized
    if (!passed) reasons.push(`objective regression exceeded: ${objective.metric}`)
    if (improvementNormalized > 0) anyImprovement = true
    weightedScore += clamp(improvementNormalized, -1, 1) * objective.weight
    weightTotal += objective.weight
    objectiveResults.push({
      metric: objective.metric,
      direction: objective.direction,
      weight: objective.weight,
      maxRegressionNormalized: objective.maxRegressionNormalized,
      candidate: metric.candidate,
      baseline: metric.baseline,
      improvementNormalized: Number(improvementNormalized.toFixed(6)),
      passed,
    })
  }
  const fitnessScore = weightTotal ? weightedScore / weightTotal : Number.NEGATIVE_INFINITY
  if (fitnessScore < policy.minimumFitness) reasons.push(`fitness ${fitnessScore.toFixed(6)} below minimum ${policy.minimumFitness.toFixed(6)}`)
  if (policy.requireAnyImprovement && !anyImprovement) reasons.push('no objective improvement observed')
  const humanApproval = options.humanApproval === true
  if (policy.humanApprovalRequired && !humanApproval) reasons.push('human approval required by risk class')

  return {
    schema: PPL_EXPERIENCE_PROMOTION_REVIEW_SCHEMA,
    reviewId: `review_${sha256({ policy: policy.policyId, asset: aggregate.asset, evidence: aggregate.evidenceSha256 }).slice(0, 20)}`,
    asset: aggregate.asset,
    policyId: policy.policyId,
    riskClass: policy.riskClass,
    decision: reasons.length ? 'hold' : 'eligible',
    eligible: reasons.length === 0,
    reasons,
    evidence: {
      evaluationCount: aggregate.evaluationCount,
      totalSamples: aggregate.totalSamples,
      evidenceClasses: aggregate.evidenceClasses,
      evidenceSha256: aggregate.evidenceSha256,
    },
    hardGates: hardGateResults,
    objectives: objectiveResults,
    fitnessScore: Number(fitnessScore.toFixed(6)),
    humanApproval: { required: policy.humanApprovalRequired, provided: humanApproval },
    reviewedAt: options.reviewedAt || new Date().toISOString(),
  }
}

export function validateEvolutionCandidate(candidate) {
  const errors = []
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { valid: false, errors: ['candidate must be object'] }
  if (candidate.schema !== PPL_EXPERIENCE_CANDIDATE_SCHEMA) errors.push(`schema must be ${PPL_EXPERIENCE_CANDIDATE_SCHEMA}`)
  if (!/^candidate_[a-f0-9]{20}$/u.test(String(candidate.candidateId || ''))) errors.push('candidateId invalid')
  if (!candidate.asset || typeof candidate.asset !== 'object') errors.push('asset required')
  requiredString(candidate.asset?.assetType, 'asset.assetType', errors)
  requiredString(candidate.asset?.assetId, 'asset.assetId', errors)
  requiredString(candidate.asset?.version, 'asset.version', errors)
  if (!isSha256(candidate.asset?.sha256)) errors.push('asset.sha256 invalid')
  if (!Number.isInteger(candidate.generation) || candidate.generation < 0) errors.push('generation invalid')
  if (!CANDIDATE_LIFECYCLES.has(String(candidate.lifecycle || ''))) errors.push('lifecycle invalid')
  if (!Array.isArray(candidate.parentCandidateIds)) errors.push('parentCandidateIds must be array')
  if (!candidate.operator || typeof candidate.operator !== 'object') errors.push('operator required')
  requiredString(candidate.operator?.kind, 'operator.kind', errors)
  requiredString(candidate.operator?.name, 'operator.name', errors)
  const sourceEpisodes = uniqStrings(candidate.sourceEpisodeSha256)
  if (sourceEpisodes.some(x => !isSha256(x))) errors.push('sourceEpisodeSha256 invalid')
  return { valid: errors.length === 0, errors }
}

export function createEvolutionCandidate(input = {}) {
  const assetSnapshot = clone(input.assetSnapshot)
  const asset = {
    assetType: String(input.asset?.assetType || 'rule').trim(),
    assetId: String(input.asset?.assetId || assetSnapshot?.ruleId || '').trim(),
    version: String(input.asset?.version || assetSnapshot?.version || '').trim(),
    sha256: String(input.asset?.sha256 || sha256(assetSnapshot || {})).trim(),
  }
  const generation = Number(input.generation ?? 0)
  const parentCandidateIds = uniqStrings(input.parentCandidateIds)
  const operator = {
    kind: String(input.operator?.kind || 'manual').trim(),
    name: String(input.operator?.name || 'manual-candidate').trim(),
    ...(input.operator?.parameters && typeof input.operator.parameters === 'object' ? { parameters: clone(input.operator.parameters) } : {}),
  }
  const sourceEpisodeSha256 = uniqStrings(input.sourceEpisodeSha256)
  const identity = { asset, generation, parentCandidateIds, operator, sourceEpisodeSha256 }
  const candidate = {
    schema: PPL_EXPERIENCE_CANDIDATE_SCHEMA,
    candidateId: `candidate_${sha256(identity).slice(0, 20)}`,
    asset,
    generation,
    parentCandidateIds,
    operator,
    sourceEpisodeSha256,
    lifecycle: String(input.lifecycle || 'candidate'),
    ...(assetSnapshot !== undefined ? { assetSnapshot } : {}),
    createdAt: input.createdAt || new Date().toISOString(),
  }
  const check = validateEvolutionCandidate(candidate)
  if (!check.valid) throw new Error(`Invalid evolution candidate: ${check.errors.join('; ')}`)
  return candidate
}

function validateCandidateGraph(candidates) {
  const byId = new Map(candidates.map(c => [c.candidateId, c]))
  for (const candidate of candidates) {
    for (const parentId of candidate.parentCandidateIds) {
      const parent = byId.get(parentId)
      if (!parent) throw new Error(`Unknown parent candidate: ${parentId}`)
      if (parent.asset.assetId !== candidate.asset.assetId || parent.asset.assetType !== candidate.asset.assetType) throw new Error('candidate parent asset mismatch')
      if (parent.generation >= candidate.generation) throw new Error('candidate generation must increase from parent')
    }
  }
  const visiting = new Set()
  const visited = new Set()
  function visit(id) {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error('candidate lineage cycle detected')
    visiting.add(id)
    for (const parentId of byId.get(id)?.parentCandidateIds || []) visit(parentId)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) visit(id)
}

export function buildEvolutionLedger(candidates = [], transitions = [], options = {}) {
  const source = arr(candidates).map(clone)
  if (!source.length) throw new Error('evolution ledger requires candidates')
  for (const candidate of source) {
    const check = validateEvolutionCandidate(candidate)
    if (!check.valid) throw new Error(`Invalid evolution candidate: ${check.errors.join('; ')}`)
  }
  const ids = source.map(c => c.candidateId)
  if (new Set(ids).size !== ids.length) throw new Error('duplicate candidateId')
  validateCandidateGraph(source)
  const assetKey = `${source[0].asset.assetType}:${source[0].asset.assetId}`
  if (source.some(c => `${c.asset.assetType}:${c.asset.assetId}` !== assetKey)) throw new Error('ledger candidates must target one asset')

  const statusById = Object.fromEntries(source.map(c => [c.candidateId, c.lifecycle]))
  const events = []
  for (const transition of arr(transitions)) {
    const candidateId = String(transition?.candidateId || '')
    if (!statusById[candidateId]) throw new Error(`transition candidate missing: ${candidateId}`)
    const from = statusById[candidateId]
    const to = String(transition?.to || '')
    if (!CANDIDATE_LIFECYCLES.has(to)) throw new Error(`transition target invalid: ${to}`)
    if (!TRANSITIONS[from]?.has(to)) throw new Error(`transition not allowed: ${from} -> ${to}`)
    const reason = String(transition?.reason || '').trim()
    if (!reason) throw new Error('transition reason required')
    const event = {
      candidateId,
      from,
      to,
      reason,
      evidenceRefs: uniqStrings(transition?.evidenceRefs),
      at: transition?.at || new Date().toISOString(),
    }
    events.push(event)
    statusById[candidateId] = to
  }
  const activeValidated = Object.entries(statusById).filter(([, status]) => status === 'validated').map(([id]) => id)
  if (activeValidated.length > 1) throw new Error('ledger cannot have multiple active validated candidates for one asset')
  return {
    schema: PPL_EXPERIENCE_EVOLUTION_LEDGER_SCHEMA,
    ledgerId: String(options.ledgerId || `ledger_${sha256({ assetKey, ids }).slice(0, 20)}`),
    asset: { assetType: source[0].asset.assetType, assetId: source[0].asset.assetId },
    candidates: source,
    transitions: events,
    statusByCandidateId: statusById,
    activeValidatedCandidateId: activeValidated[0] || null,
    generatedAt: options.generatedAt || new Date().toISOString(),
  }
}

export function applyEvolutionTransition(ledger, transition) {
  if (ledger?.schema !== PPL_EXPERIENCE_EVOLUTION_LEDGER_SCHEMA) throw new Error('invalid evolution ledger')
  return buildEvolutionLedger(ledger.candidates, [...ledger.transitions, transition], { ledgerId: ledger.ledgerId })
}

export function rankEvolutionCandidates(candidates = [], reviewsByCandidate = {}) {
  const rows = []
  for (const candidate of arr(candidates)) {
    const check = validateEvolutionCandidate(candidate)
    if (!check.valid) throw new Error(`Invalid evolution candidate: ${check.errors.join('; ')}`)
    const review = reviewsByCandidate[candidate.candidateId]
    if (!review || review.schema !== PPL_EXPERIENCE_PROMOTION_REVIEW_SCHEMA || review.eligible !== true || !isFiniteNumber(review.fitnessScore)) continue
    if (['retired', 'rolled-back'].includes(candidate.lifecycle)) continue
    rows.push({ candidate, review })
  }
  rows.sort((a, b) => {
    if (b.review.fitnessScore !== a.review.fitnessScore) return b.review.fitnessScore - a.review.fitnessScore
    if (b.candidate.generation !== a.candidate.generation) return b.candidate.generation - a.candidate.generation
    return a.candidate.candidateId.localeCompare(b.candidate.candidateId)
  })
  return rows.map((row, index) => ({ rank: index + 1, candidateId: row.candidate.candidateId, generation: row.candidate.generation, fitnessScore: row.review.fitnessScore }))
}

export function detectEvolutionConvergence(history = [], config = {}) {
  const patience = Number(config.patience ?? 3)
  const minImprovement = Number(config.minImprovement ?? 0.01)
  if (!Number.isInteger(patience) || patience < 1) throw new Error('convergence patience invalid')
  if (!isFiniteNumber(minImprovement) || minImprovement < 0) throw new Error('convergence minImprovement invalid')
  const eligible = arr(history)
    .filter(x => x?.eligible !== false && isFiniteNumber(x?.fitnessScore) && Number.isInteger(x?.generation))
    .sort((a, b) => a.generation - b.generation)
  if (!eligible.length) return { converged: false, reason: 'no-eligible-history', patience, minImprovement, stagnantGenerations: 0, bestFitness: null }
  let bestFitness = Number.NEGATIVE_INFINITY
  let lastImprovementIndex = -1
  for (let i = 0; i < eligible.length; i++) {
    const fitness = eligible[i].fitnessScore
    if (bestFitness === Number.NEGATIVE_INFINITY || fitness > bestFitness + minImprovement) {
      bestFitness = fitness
      lastImprovementIndex = i
    }
  }
  const stagnantGenerations = eligible.length - 1 - lastImprovementIndex
  return {
    converged: stagnantGenerations >= patience,
    reason: stagnantGenerations >= patience ? 'no-material-improvement' : 'continue',
    patience,
    minImprovement,
    stagnantGenerations,
    bestFitness: Number(bestFitness.toFixed(6)),
    observations: eligible.length,
  }
}

export function planRestoreBest(ledger, reviewsByCandidate = {}, currentCandidateId = ledger?.activeValidatedCandidateId) {
  if (ledger?.schema !== PPL_EXPERIENCE_EVOLUTION_LEDGER_SCHEMA) throw new Error('invalid evolution ledger')
  if (!currentCandidateId || !ledger.statusByCandidateId[currentCandidateId]) throw new Error('current candidate required')
  const restorable = ledger.candidates.filter(candidate => {
    const status = ledger.statusByCandidateId[candidate.candidateId]
    return ['validated', 'superseded', 'qualified'].includes(status)
  }).map(candidate => ({ ...candidate, lifecycle: ledger.statusByCandidateId[candidate.candidateId] }))
  const ranking = rankEvolutionCandidates(restorable, reviewsByCandidate)
  if (!ranking.length) return { action: 'hold', reason: 'no-eligible-restore-target', currentCandidateId, targetCandidateId: null, transitions: [] }
  const targetCandidateId = ranking[0].candidateId
  if (targetCandidateId === currentCandidateId) return { action: 'keep-current', currentCandidateId, targetCandidateId, transitions: [] }
  const targetStatus = ledger.statusByCandidateId[targetCandidateId]
  const currentStatus = ledger.statusByCandidateId[currentCandidateId]
  const transitions = []
  if (currentStatus === 'validated') transitions.push({ candidateId: currentCandidateId, to: 'rolled-back', reason: `restore-best:${targetCandidateId}` })
  if (targetStatus === 'superseded') transitions.push({ candidateId: targetCandidateId, to: 'validated', reason: `restore-best-from:${currentCandidateId}` })
  if (targetStatus === 'qualified') transitions.push({ candidateId: targetCandidateId, to: 'validated', reason: `promote-best-qualified-from:${currentCandidateId}` })
  return { action: 'restore-best', currentCandidateId, targetCandidateId, ranking, transitions }
}

export function promoteRuleCandidate(rule, candidate, review, options = {}) {
  const ruleCheck = validateExperienceRule(rule)
  if (!ruleCheck.valid) throw new Error(`invalid rule: ${ruleCheck.errors.join('; ')}`)
  const candidateCheck = validateEvolutionCandidate(candidate)
  if (!candidateCheck.valid) throw new Error(`invalid candidate: ${candidateCheck.errors.join('; ')}`)
  if (review?.schema !== PPL_EXPERIENCE_PROMOTION_REVIEW_SCHEMA || review.eligible !== true) throw new Error('promotion review must be eligible')
  if (candidate.asset.assetType !== 'rule' || candidate.asset.assetId !== rule.ruleId || candidate.asset.version !== rule.version) throw new Error('candidate does not reference rule version')
  if (candidate.asset.sha256 !== sha256(rule)) throw new Error('candidate asset hash mismatch')
  if (rule.status !== 'candidate') throw new Error('only candidate rule can be promoted')
  const promoted = clone(rule)
  promoted.status = 'validated'
  promoted.validation = {
    ...(promoted.validation || {}),
    evolutionGovernance: {
      candidateId: candidate.candidateId,
      reviewId: review.reviewId,
      fitnessScore: review.fitnessScore,
      promotedAt: options.promotedAt || new Date().toISOString(),
    },
  }
  return promoted
}

export function hashExperienceAsset(value) { return sha256(value) }
