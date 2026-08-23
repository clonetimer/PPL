import {
  appendActiveRule, appendResolutionArtifact, appendResolutionDiagnostic, clone, getPath,
  recordStateMutation, refreshResolution, resolveProfileEventGeneric,
} from '@ppl/profile-core'

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value)))
const round = (value, digits = 4) => Number(Number(value).toFixed(digits))
const keyOf = value => String(value || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'

function stateMutation(resolution, source, path, value, priority = 1000, op = 'set') {
  return recordStateMutation(resolution, { source, priority, path, value, op })
}

function provenanceComplete(source = {}) {
  // A title/publisher pair is descriptive metadata, not a stable locator.
  // Ready conclusions require evidence that can be re-located by an external reviewer.
  return Boolean(source.arxivId || source.doi || source.locator || source.url)
}


export function evidenceQuality(payload = {}, claim = {}) {
  const q = payload.quality || {}
  const relevance = clamp(q.relevance ?? payload.relevance ?? 0.75)
  const reliability = clamp(q.reliability ?? payload.reliability ?? 0.75)
  const independence = clamp(q.independence ?? payload.independence ?? 1)
  const group = String(payload.independenceGroup || payload.source?.independenceGroup || payload.source?.publisher || payload.source?.id || payload.evidenceId || 'unknown')
  const correlated = (claim.sourceGroups || []).includes(group)
  const correlationFactor = correlated ? 0.35 : 1
  return {
    relevance: round(relevance), reliability: round(reliability), independence: round(independence),
    group, correlated, correlationFactor, weight: round(relevance * reliability * independence * correlationFactor),
  }
}

function initialClaim(id, text, kind = 'claim') {
  return {
    id,
    text,
    kind,
    status: 'proposed',
    supportMass: 0,
    opposeMass: 0,
    neutralMass: 0,
    uncertainty: 1,
    evidenceCount: 0,
    independentSourceCount: 0,
    sourceGroups: [],
    supportGroups: [],
    opposeGroups: [],
    provenanceComplete: true,
    validation: { attempts: 0, supportive: 0, opposing: 0, inconclusive: 0, reproducibleSupport: 0, reproducibleOppose: 0, strongSupport: 0, strongOppose: 0, last: null },
    decision: { status: 'blocked', reasons: ['no-evidence'] },
  }
}

function recomputeClaim(claim, thresholds = {}) {
  const support = Number(claim.supportMass || 0)
  const oppose = Number(claim.opposeMass || 0)
  const neutral = Number(claim.neutralMass || 0)
  const total = support + oppose + neutral
  const minConflictMass = Number(thresholds.minConflictMass ?? 0.6)
  const maxSide = Math.max(support, oppose)
  const minSide = Math.min(support, oppose)
  const balanceRatio = maxSide > 0 ? minSide / maxSide : 0
  const material = support >= minConflictMass && oppose >= minConflictMass
  const inconclusiveBalanceRatio = Number(thresholds.inconclusiveBalanceRatio ?? 0.55)
  const unresolvedBalancedConflict = material && balanceRatio >= inconclusiveBalanceRatio
  let uncertainty = 1 / (1 + total)
  // Material counter-evidence is retained, but only unresolved balanced conflict imposes
  // an uncertainty floor. Strong later validation may legitimately create a dominant
  // direction while preserving the historical counter-evidence in the ledger.
  if (unresolvedBalancedConflict) uncertainty = Math.max(uncertainty, 0.45)
  if (!claim.provenanceComplete) uncertainty = Math.max(uncertainty, 0.55)
  claim.uncertainty = round(clamp(uncertainty))
  claim.evidenceCount = Number(claim.evidenceCount || 0)
  claim.independentSourceCount = new Set(claim.sourceGroups || []).size
  claim.conflict = {
    present: material,
    supportMass: round(support),
    opposeMass: round(oppose),
    balanceRatio: round(balanceRatio),
    dominantStance: support === oppose ? 'balanced' : support > oppose ? 'support' : 'oppose',
  }
  if (unresolvedBalancedConflict) claim.status = 'conflicted'
  else if (claim.evidenceCount > 0 || (claim.validation?.attempts || 0) > 0) claim.status = 'testing'
  return claim
}

export function decisionForClaim(claim, thresholds = {}) {
  const minDominant = Number(thresholds.minDominantMass ?? thresholds.minSupportMass ?? 1.2)
  const minIndependentDominant = Number(thresholds.minIndependentDominant ?? thresholds.minIndependentSupport ?? 2)
  const maxReadyCounterRatio = Number(thresholds.maxReadyCounterRatio ?? 0.35)
  const maxReadyUncertainty = Number(thresholds.maxReadyUncertainty ?? 0.35)
  const minConflictMass = Number(thresholds.minConflictMass ?? 0.6)
  const inconclusiveBalanceRatio = Number(thresholds.inconclusiveBalanceRatio ?? 0.55)
  const supportGroups = new Set(claim.supportGroups || []).size
  const opposeGroups = new Set(claim.opposeGroups || []).size
  const support = Number(claim.supportMass || 0)
  const oppose = Number(claim.opposeMass || 0)
  const maxSide = Math.max(support, oppose)
  const minSide = Math.min(support, oppose)
  const balanceRatio = maxSide > 0 ? minSide / maxSide : 0
  const materialConflict = support >= minConflictMass && oppose >= minConflictMass
  const balancedConflict = materialConflict && balanceRatio >= inconclusiveBalanceRatio
  const direction = support === oppose ? (support > 0 ? 'mixed' : 'undetermined') : support > oppose ? 'support' : 'oppose'

  const hardReasons = []
  if (!claim.provenanceComplete) hardReasons.push('incomplete-provenance')
  if ((claim.validation?.attempts || 0) < 1) hardReasons.push('no-validation-attempt')
  if (claim.uncertainty > 0.65) hardReasons.push('uncertainty-too-high')
  if (hardReasons.length) return { status: 'blocked', direction, reasons: hardReasons, conflict: clone(claim.conflict) }

  // A mature scientific decision is directional, but status and direction are separate.
  // A claim can be ready+support or ready+oppose; unresolved balanced conflict remains inconclusive.
  if (balancedConflict && supportGroups >= 1 && opposeGroups >= 1) {
    const reasons = ['material-conflict-unresolved']
    if ((claim.validation?.strongSupport || 0) + (claim.validation?.strongOppose || 0) < 1) reasons.push('strong-validation-needed-to-resolve-conflict')
    return { status: 'inconclusive', direction: 'mixed', reasons, conflict: clone(claim.conflict) }
  }

  const dominantMass = direction === 'oppose' ? oppose : support
  const counterMass = direction === 'oppose' ? support : oppose
  const dominantGroups = direction === 'oppose' ? opposeGroups : supportGroups
  const dominantStrong = direction === 'oppose' ? Number(claim.validation?.strongOppose || 0) : Number(claim.validation?.strongSupport || 0)
  const gateReasons = []
  if (!['support', 'oppose'].includes(direction)) gateReasons.push('no-dominant-direction')
  if (dominantMass < minDominant) gateReasons.push('insufficient-dominant-mass')
  if (dominantGroups < minIndependentDominant) gateReasons.push('insufficient-independent-dominant-sources')
  if (gateReasons.length) return { status: 'blocked', direction, reasons: gateReasons, conflict: clone(claim.conflict) }

  const counterRatio = dominantMass > 0 ? counterMass / dominantMass : 1
  const minStrongValidation = Number(thresholds.minStrongValidation ?? 1)
  const strongEnough = dominantStrong >= minStrongValidation
  const ready = counterRatio <= maxReadyCounterRatio && claim.uncertainty <= maxReadyUncertainty && strongEnough
  if (ready) return { status: 'ready', direction, reasons: [], counterRatio: round(counterRatio), conflict: clone(claim.conflict) }

  const caveats = []
  if (counterRatio > maxReadyCounterRatio) caveats.push('counter-evidence-ratio-above-ready-threshold')
  if (!strongEnough) caveats.push('strong-validation-required')
  if (claim.uncertainty > maxReadyUncertainty) caveats.push('uncertainty-above-ready-threshold')
  return { status: 'qualified', direction, reasons: caveats.length ? caveats : ['validation-caveat'], counterRatio: round(counterRatio), conflict: clone(claim.conflict) }
}

function activeClaim(resolution, event) {
  const id = event.payload?.claimId || getPath(resolution.resolvedState, 'research.activeClaimId')
  if (!id) return { id: null, key: null, claim: null }
  const key = keyOf(id)
  return { id, key, claim: clone(getPath(resolution.resolvedState, `research.claims.${key}`)) }
}

function handleQuestion(resolution, event) {
  appendActiveRule(resolution, { id: 'RESEARCH_QUESTION_LEDGER', priority: 1100, rationale: '研究问题必须成为后续 claim/evidence 的显式锚点。' })
  stateMutation(resolution, 'RESEARCH_QUESTION_LEDGER', 'research.question', String(event.payload?.question || ''), 1100)
  stateMutation(resolution, 'RESEARCH_QUESTION_LEDGER', 'workflow.nextAction', 'propose-or-collect-claims', 1100)
}

function handleClaim(resolution, event) {
  const payload = event.payload || {}
  const id = String(payload.claimId || event.id || '').trim()
  if (!id || !payload.text) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'RESEARCH_CLAIM_ID_TEXT_REQUIRED', message: 'CLAIM_PROPOSED 需要 claimId 与 text。' })
    return
  }
  const key = keyOf(id)
  const path = `research.claims.${key}`
  if (getPath(resolution.resolvedState, path)) {
    appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'RESEARCH_DUPLICATE_CLAIM_IGNORED', message: `claimId ${id} 已存在。` })
    return
  }
  const claim = initialClaim(id, String(payload.text), payload.kind || 'hypothesis')
  appendActiveRule(resolution, { id: 'RESEARCH_CLAIM_LIFECYCLE', priority: 1080, rationale: '生成 hypothesis/claim 不等于建立结论；新 claim 默认 proposed。' })
  stateMutation(resolution, 'RESEARCH_CLAIM_LIFECYCLE', path, claim, 1080)
  const order = getPath(resolution.resolvedState, 'research.claimOrder') || []
  stateMutation(resolution, 'RESEARCH_CLAIM_LIFECYCLE', 'research.claimOrder', [...order, id], 1080, 'append')
  stateMutation(resolution, 'RESEARCH_CLAIM_LIFECYCLE', 'research.activeClaimId', id, 1080)
  stateMutation(resolution, 'RESEARCH_CLAIM_LIFECYCLE', 'workflow.nextAction', 'collect-independent-evidence', 1080)
  appendResolutionArtifact(resolution, { type: 'research-claim', claim: clone(claim) })
}

function handleEvidence(profile, resolution, event) {
  const payload = event.payload || {}
  const evidenceId = String(payload.evidenceId || event.id || '').trim()
  if (!evidenceId) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'RESEARCH_EVIDENCE_ID_REQUIRED', message: 'EVIDENCE_RECORDED 需要稳定 evidenceId。' })
    return
  }
  const seen = getPath(resolution.resolvedState, 'research.evidenceIds') || []
  if (seen.includes(evidenceId)) {
    appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'RESEARCH_DUPLICATE_EVIDENCE_IGNORED', message: `evidenceId ${evidenceId} 已处理，拒绝重复计权。` })
    return
  }
  const target = activeClaim(resolution, event)
  if (!target.claim) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'RESEARCH_CLAIM_NOT_FOUND', message: 'Evidence 必须绑定已存在 claim。' })
    return
  }
  const stance = ['support', 'oppose', 'neutral'].includes(payload.stance) ? payload.stance : 'neutral'
  const quality = evidenceQuality(payload, target.claim)
  const source = clone(payload.source || {})
  const provOk = provenanceComplete(source)
  const entry = {
    evidenceId,
    claimId: target.id,
    stance,
    summary: payload.summary || '',
    source,
    quality,
    provenanceComplete: provOk,
  }

  appendActiveRule(resolution, { id: 'RESEARCH_EVIDENCE_LEDGER', priority: 1120, rationale: 'Evidence 以可去重 ledger 保存，support/oppose 分离，不通过平均冲突来制造确定性。' })
  const ledger = getPath(resolution.resolvedState, 'research.evidenceLedger') || []
  stateMutation(resolution, 'RESEARCH_EVIDENCE_LEDGER', 'research.evidenceLedger', [...ledger, entry], 1120, 'append')
  stateMutation(resolution, 'RESEARCH_EVIDENCE_LEDGER', 'research.evidenceIds', [...seen, evidenceId], 1120, 'appendUnique')

  const claim = clone(target.claim)
  claim.evidenceCount += 1
  claim.provenanceComplete = Boolean(claim.provenanceComplete && provOk)
  if (!claim.sourceGroups.includes(quality.group)) claim.sourceGroups.push(quality.group)
  if (stance === 'support') {
    claim.supportMass = round(Number(claim.supportMass || 0) + quality.weight)
    if (!claim.supportGroups.includes(quality.group)) claim.supportGroups.push(quality.group)
  } else if (stance === 'oppose') {
    claim.opposeMass = round(Number(claim.opposeMass || 0) + quality.weight)
    if (!claim.opposeGroups.includes(quality.group)) claim.opposeGroups.push(quality.group)
  } else claim.neutralMass = round(Number(claim.neutralMass || 0) + quality.weight)
  recomputeClaim(claim, profile.researchModel?.decisionThresholds)
  claim.decision = decisionForClaim(claim, profile.researchModel?.decisionThresholds)
  stateMutation(resolution, 'RESEARCH_EVIDENCE_LEDGER', `research.claims.${target.key}`, claim, 1120, 'evidence-update')

  if (quality.correlated) appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'RESEARCH_CORRELATED_EVIDENCE_DOWNWEIGHTED', message: `来源组 ${quality.group} 已出现，本条 evidence 按 0.35 相关性系数降权。` })
  if (!provOk) appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'RESEARCH_INCOMPLETE_PROVENANCE', message: `evidenceId ${evidenceId} 缺少可定位来源，不能支持 ready conclusion。` })
  if (claim.supportMass >= 0.4 && claim.opposeMass >= 0.4) appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'RESEARCH_CONFLICT_RETAINED', message: '同一 claim 同时存在支持与反对证据，冲突被显式保留。' })
  stateMutation(resolution, 'RESEARCH_EVIDENCE_LEDGER', 'workflow.nextAction', claim.status === 'conflicted' ? 'resolve-or-characterize-conflict' : 'seek-independent-evidence', 1120)
  appendResolutionArtifact(resolution, { type: 'research-evidence', ...entry, claimAfter: clone(claim) })
}

function handleValidation(profile, resolution, event) {
  const payload = event.payload || {}
  const target = activeClaim(resolution, event)
  if (!target.claim) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'RESEARCH_CLAIM_NOT_FOUND', message: 'VALIDATION_RESULT 必须绑定 claim。' })
    return
  }
  const validationId = String(payload.validationId || event.id || '').trim()
  if (!validationId) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'RESEARCH_VALIDATION_ID_REQUIRED', message: 'VALIDATION_RESULT 需要 validationId。' })
    return
  }
  const ledger = getPath(resolution.resolvedState, 'research.validationLedger') || []
  if (ledger.some(x => x.validationId === validationId)) {
    appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'RESEARCH_DUPLICATE_VALIDATION_IGNORED', message: `validationId ${validationId} 已处理。` })
    return
  }
  const outcome = ['support', 'oppose', 'inconclusive'].includes(payload.outcome) ? payload.outcome : 'inconclusive'
  const confidence = clamp(payload.confidence ?? 0.7)
  const reproducible = Boolean(payload.reproducible)
  const kind = String(payload.kind || 'unspecified')
  const strongKinds = new Set(profile.researchModel?.readyValidationKinds || ['replication', 'experiment', 'formal-check'])
  const validationSource = payload.provenance || payload.artifact || {}
  const validationProvenanceComplete = provenanceComplete(validationSource)
  const strongMethod = Boolean(payload.strong === true || (reproducible && strongKinds.has(kind)))
  const strong = Boolean(strongMethod && reproducible && validationProvenanceComplete)
  const independenceGroup = String(payload.independenceGroup || payload.provenance?.independenceGroup || payload.provenance?.lab || payload.provenance?.publisher || `validation:${validationId}`)
  const weight = round(confidence * (reproducible ? 1 : 0.60))
  const row = { validationId, claimId: target.id, kind, method: payload.method || 'unspecified', outcome, confidence, reproducible, strong, strongMethod, independenceGroup, provenanceComplete: validationProvenanceComplete, provenance: clone(payload.provenance), artifact: clone(payload.artifact) }
  appendActiveRule(resolution, { id: 'RESEARCH_VALIDATION_LIFECYCLE', priority: 1140, rationale: 'Validation 是独立生命周期阶段；验证结果不能被 hypothesis generation 本身替代。' })
  stateMutation(resolution, 'RESEARCH_VALIDATION_LIFECYCLE', 'research.validationLedger', [...ledger, row], 1140, 'append')
  const claim = clone(target.claim)
  claim.validation.attempts += 1
  if (outcome === 'support') {
    claim.validation.supportive += 1
    if (reproducible) claim.validation.reproducibleSupport += 1
    if (strong) claim.validation.strongSupport = Number(claim.validation.strongSupport || 0) + 1
    claim.supportMass = round(claim.supportMass + weight)
    if (!claim.sourceGroups.includes(independenceGroup)) claim.sourceGroups.push(independenceGroup)
    if (!claim.supportGroups.includes(independenceGroup)) claim.supportGroups.push(independenceGroup)
  } else if (outcome === 'oppose') {
    claim.validation.opposing += 1
    if (reproducible) claim.validation.reproducibleOppose += 1
    if (strong) claim.validation.strongOppose = Number(claim.validation.strongOppose || 0) + 1
    claim.opposeMass = round(claim.opposeMass + weight)
    if (!claim.sourceGroups.includes(independenceGroup)) claim.sourceGroups.push(independenceGroup)
    if (!claim.opposeGroups.includes(independenceGroup)) claim.opposeGroups.push(independenceGroup)
  } else claim.validation.inconclusive += 1
  if (strongMethod && !validationProvenanceComplete) appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'RESEARCH_STRONG_VALIDATION_PROVENANCE_REQUIRED', message: `validationId ${validationId} 方法可视为强验证，但缺少 DOI/URL/locator 等可复核 provenance，因此不计入 ready strong-validation gate。` })
  claim.validation.last = row
  recomputeClaim(claim, profile.researchModel?.decisionThresholds)
  claim.decision = decisionForClaim(claim, profile.researchModel?.decisionThresholds)
  stateMutation(resolution, 'RESEARCH_VALIDATION_LIFECYCLE', `research.claims.${target.key}`, claim, 1140, 'validation-update')
  stateMutation(resolution, 'RESEARCH_VALIDATION_LIFECYCLE', 'workflow.nextAction', 'evaluate-conclusion-gates', 1140)
  appendResolutionArtifact(resolution, { type: 'research-validation', ...row, claimAfter: clone(claim) })
}

function handleConclusion(profile, resolution, event) {
  const target = activeClaim(resolution, event)
  if (!target.claim) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'RESEARCH_CLAIM_NOT_FOUND', message: 'CONCLUSION_REQUESTED 必须绑定 claim。' })
    return
  }
  const claim = clone(target.claim)
  const decision = decisionForClaim(claim, profile.researchModel?.decisionThresholds)
  claim.decision = decision
  claim.status = decision.status
  appendActiveRule(resolution, { id: 'RESEARCH_CONCLUSION_GATE', priority: 1200, rationale: '结论必须经过 evidence independence、provenance、validation 和 uncertainty gate。' })
  stateMutation(resolution, 'RESEARCH_CONCLUSION_GATE', `research.claims.${target.key}`, claim, 1200, 'decision-gate')
  stateMutation(resolution, 'RESEARCH_CONCLUSION_GATE', 'research.conclusionStatus', decision.status, 1200)
  stateMutation(resolution, 'RESEARCH_CONCLUSION_GATE', 'research.conclusionDirection', decision.direction || 'undetermined', 1200)
  stateMutation(resolution, 'RESEARCH_CONCLUSION_GATE', 'workflow.nextAction', decision.status === 'ready' ? (decision.direction === 'oppose' ? 'report-refutation' : 'report') : decision.status === 'qualified' ? 'report-with-caveats' : decision.status === 'inconclusive' ? 'characterize-conflict-or-run-strong-validation' : 'collect-or-validate-more', 1200)
  if (decision.status === 'blocked') appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'RESEARCH_PREMATURE_CONCLUSION_BLOCKED', message: `结论门禁未通过：${decision.reasons.join(', ')}` })
  if (decision.status === 'qualified') appendResolutionDiagnostic(resolution, { severity: 'info', code: 'RESEARCH_QUALIFIED_CONCLUSION', message: `允许带限定条件报告：${decision.reasons.join(', ') || 'caveats retained'}` })
  if (decision.status === 'inconclusive') appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'RESEARCH_INCONCLUSIVE_CONCLUSION', message: `支持与反对证据均达到实质规模且仍较均衡：${decision.reasons.join(', ')}` })
  appendResolutionArtifact(resolution, { type: 'research-decision', claimId: target.id, decision: clone(decision), claim: clone(claim) })
}

export function resolveResearchEvent(profile, baseState, event, context = {}) {
  const resolution = resolveProfileEventGeneric(profile, baseState, event, context)
  if (event.type === 'QUESTION_DEFINED') handleQuestion(resolution, event)
  else if (event.type === 'CLAIM_PROPOSED') handleClaim(resolution, event)
  else if (event.type === 'EVIDENCE_RECORDED') handleEvidence(profile, resolution, event)
  else if (event.type === 'VALIDATION_RESULT') handleValidation(profile, resolution, event)
  else if (event.type === 'CONCLUSION_REQUESTED') handleConclusion(profile, resolution, event)
  return refreshResolution(profile, resolution)
}

export function summarizeResearchState(state) {
  const activeClaimId = getPath(state, 'research.activeClaimId')
  const claim = activeClaimId ? getPath(state, `research.claims.${keyOf(activeClaimId)}`) : undefined
  return {
    question: getPath(state, 'research.question'),
    activeClaimId,
    claim: clone(claim),
    evidenceLedger: clone(getPath(state, 'research.evidenceLedger') || []),
    validationLedger: clone(getPath(state, 'research.validationLedger') || []),
    conclusionStatus: getPath(state, 'research.conclusionStatus'),
    nextAction: getPath(state, 'workflow.nextAction'),
  }
}
