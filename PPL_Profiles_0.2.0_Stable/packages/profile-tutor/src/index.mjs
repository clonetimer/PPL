import {
  appendActiveRule, appendResolutionArtifact, appendResolutionDiagnostic, clone, getPath,
  recordStateMutation, refreshResolution, resolveProfileEventGeneric, stableStringify,
} from '@ppl/profile-core'

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value)))
const round = (value, digits = 4) => Number(Number(value).toFixed(digits))

export function canonicalSkillKey(skillId) {
  const text = String(skillId || 'unknown').trim().toLowerCase()
  return text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'
}

export function betaStats(alpha, beta) {
  const a = Math.max(0.0001, Number(alpha))
  const b = Math.max(0.0001, Number(beta))
  const sum = a + b
  const mean = a / sum
  const variance = (a * b) / (sum * sum * (sum + 1))
  const posteriorStd = Math.sqrt(variance)
  // Normalized spread: an interpretable observability signal, not a calibrated probability of error.
  const uncertainty = clamp(posteriorStd / 0.25)
  return { alpha: round(a), beta: round(b), mean: round(mean), variance: round(variance, 6), posteriorStd: round(posteriorStd, 6), uncertainty: round(uncertainty) }
}

export function assessmentEvidenceWeight(payload = {}, scoreInput, policy = {}) {
  const assessment = payload.assessment || {}
  const score = scoreInput === undefined ? (payload.score ?? (payload.correct === true ? 1 : payload.correct === false ? 0 : undefined)) : scoreInput
  const outcome = score === undefined || Number.isNaN(Number(score)) ? undefined : clamp(score)
  let reliability = clamp(payload.sourceReliability ?? assessment.reliability ?? 0.85)
  if (assessment.original === false || assessment.original === 0) reliability *= 0.75

  const hints = Math.max(0, Number(assessment.hintCount ?? assessment.hints ?? 0))
  const attempts = Math.max(1, Number(assessment.attemptCount ?? assessment.attempts ?? 1))
  const answerRevealed = Boolean(assessment.answerRevealed)
  const firstAction = String(assessment.firstAction || '').toLowerCase()
  const helpRequested = Boolean(
    assessment.helpRequested === true || hints > 0 || answerRevealed || firstAction === 'hint' || firstAction === 'scaffolding'
  )
  const assistanceUsed = helpRequested || attempts > 1

  const cfg = {
    directSuccess: Number(policy.directFirstAttemptSuccess ?? policy.directFirstAttempt ?? 1.0),
    multiAttemptSuccess: Number(policy.multiAttemptSuccess ?? policy.multiAttempt ?? 0.60),
    hintedSuccess: Number(policy.hintedSuccess ?? policy.hinted ?? 0.30),
    answerRevealedSuccess: Number(policy.answerRevealedSuccess ?? policy.answerRevealed ?? 0.05),
    firstAttemptFailure: Number(policy.firstAttemptFailure ?? 1.0),
    assistedFailure: Number(policy.assistedFailure ?? 0.90),
    bottomHintFailure: Number(policy.bottomHintFailure ?? 0.95),
  }

  let validity = cfg.directSuccess
  let direction = 'unknown'
  let reason = 'outcome-unavailable'
  if (outcome !== undefined && outcome >= 0.5) {
    direction = 'mastery-support'
    if (answerRevealed) { validity = cfg.answerRevealedSuccess; reason = 'success-after-answer-reveal' }
    else if (hints > 0 || helpRequested) { validity = cfg.hintedSuccess; reason = 'success-with-help' }
    else if (attempts > 1) { validity = cfg.multiAttemptSuccess; reason = 'success-after-multiple-attempts' }
    else { validity = cfg.directSuccess; reason = 'unaided-first-attempt-success' }
  } else if (outcome !== undefined) {
    // ASSISTments-style first-attempt incorrect/help-request outcomes are evidence *against*
    // unaided mastery. Assistance weakens positive success evidence, but it must not erase the
    // fact that the learner needed help or failed the first attempt.
    direction = 'nonmastery-support'
    if (answerRevealed || assessment.bottomHint === true) { validity = cfg.bottomHintFailure; reason = 'bottom-hint-or-answer-reveal-needed' }
    else if (assistanceUsed) { validity = cfg.assistedFailure; reason = 'first-attempt-failure-or-assistance-needed' }
    else { validity = cfg.firstAttemptFailure; reason = 'direct-first-attempt-failure' }
  }

  const weight = clamp(reliability * validity)
  return {
    reliability: round(reliability), validity: round(validity), weight: round(weight),
    assisted: assistanceUsed, assistanceUsed, helpRequested, hints, attempts, answerRevealed,
    direction, reason,
  }
}

function priorModel(profile, skillId) {
  const prior = profile.tutorModel?.betaPrior || { alpha: 2, beta: 4 }
  return {
    skillId,
    ...betaStats(prior.alpha, prior.beta),
    evidenceWeight: 0,
    observations: 0,
    directAssessments: 0,
    assistedAssessments: 0,
    unaidedSuccesses: 0,
    firstAttemptFailures: 0,
    assistanceEpisodes: 0,
    lastEvidenceId: null,
  }
}

function stateMutation(resolution, source, path, value, priority = 1000, op = 'set') {
  return recordStateMutation(resolution, { source, priority, path, value, op })
}

function policyFor(model, misconception) {
  if (misconception?.status === 'active') return { mode: 'misconception-repair', hintLevel: 2, reason: 'active-misconception' }
  if (model.uncertainty >= 0.60) return { mode: 'diagnose', hintLevel: 1, reason: 'high-knowledge-uncertainty' }
  if (model.mean < 0.45) return { mode: 'worked-example', hintLevel: 2, reason: 'low-mastery' }
  if (model.mean < 0.72) return { mode: 'socratic', hintLevel: 1, reason: 'developing-mastery' }
  return { mode: 'challenge', hintLevel: 0, reason: 'high-mastery' }
}

function recommendedDifficulty(model) {
  if (model.uncertainty > 0.55) return 1
  if (model.mean >= 0.85) return 5
  if (model.mean >= 0.72) return 4
  if (model.mean >= 0.55) return 3
  if (model.mean >= 0.38) return 2
  return 1
}

function updateMisconception(resolution, payload, evidence, score) {
  const id = payload.misconception?.id || payload.misconceptionId
  if (!id) return null
  const key = canonicalSkillKey(id)
  const path = `learner.misconceptions.${key}`
  const before = clone(getPath(resolution.resolvedState, path) || { id, support: 0, contradiction: 0, confidence: 0, status: 'candidate', evidenceIds: [] })
  const signalConfidence = clamp(payload.misconception?.confidence ?? payload.misconceptionConfidence ?? 0.7)
  let support = Number(before.support || 0)
  let contradiction = Number(before.contradiction || 0)
  if (score < 0.5) support += evidence.weight * signalConfidence
  else contradiction += evidence.weight * 0.65
  const confidence = support / (support + contradiction + 0.75)
  let status = 'candidate'
  if (support >= 1.0 && confidence >= 0.55) status = 'active'
  if (contradiction >= 1.0 && contradiction > support * 1.15) status = 'resolved'
  const next = {
    id,
    support: round(support),
    contradiction: round(contradiction),
    confidence: round(confidence),
    status,
    evidenceIds: [...new Set([...(before.evidenceIds || []), payload.evidenceId].filter(Boolean))],
  }
  stateMutation(resolution, 'TUTOR_MISCONCEPTION_EVIDENCE', path, next, 1040)
  appendActiveRule(resolution, { id: 'TUTOR_MISCONCEPTION_EVIDENCE', priority: 1040, rationale: '错误概念需要累积证据，不因单次正确/错误直接定论。' })
  return next
}

function handleObservation(profile, resolution, event) {
  const payload = event.payload || {}
  const evidenceId = String(payload.evidenceId || event.id || '').trim()
  if (!evidenceId) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'TUTOR_EVIDENCE_ID_REQUIRED', message: '学习观察必须携带稳定 evidenceId，避免重复计数。' })
    return
  }
  const seen = getPath(resolution.resolvedState, 'learner.evidenceIds') || []
  if (seen.includes(evidenceId)) {
    appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'TUTOR_DUPLICATE_EVIDENCE_IGNORED', message: `evidenceId ${evidenceId} 已处理，本轮不重复更新知识状态。` })
    appendResolutionArtifact(resolution, { type: 'tutor-evidence', evidenceId, accepted: false, reason: 'duplicate' })
    return
  }

  const skillId = String(payload.skillId || payload.skill || getPath(resolution.resolvedState, 'learner.currentSkillId') || 'unknown')
  const skillKey = canonicalSkillKey(skillId)
  const skillPath = `learner.skills.${skillKey}`
  const model = clone(getPath(resolution.resolvedState, skillPath) || priorModel(profile, skillId))
  const rawScore = payload.score ?? (payload.correct === true ? 1 : payload.correct === false ? 0 : undefined)
  const evidence = assessmentEvidenceWeight(payload, rawScore, profile.tutorModel?.evidencePolicy)
  if (rawScore === undefined || Number.isNaN(Number(rawScore))) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'TUTOR_OUTCOME_REQUIRED', message: 'LEARNER_OBSERVATION 需要 score 或 correct。' })
    return
  }
  const score = clamp(rawScore)
  const alpha = model.alpha + evidence.weight * score
  const beta = model.beta + evidence.weight * (1 - score)
  const stats = betaStats(alpha, beta)
  const next = {
    ...model,
    ...stats,
    evidenceWeight: round(Number(model.evidenceWeight || 0) + evidence.weight),
    observations: Number(model.observations || 0) + 1,
    directAssessments: Number(model.directAssessments || 0) + (evidence.assisted ? 0 : 1),
    assistedAssessments: Number(model.assistedAssessments || 0) + (evidence.assisted ? 1 : 0),
    unaidedSuccesses: Number(model.unaidedSuccesses || 0) + (score >= 0.5 && !evidence.assistanceUsed ? 1 : 0),
    firstAttemptFailures: Number(model.firstAttemptFailures || 0) + (score < 0.5 ? 1 : 0),
    assistanceEpisodes: Number(model.assistanceEpisodes || 0) + (evidence.assistanceUsed ? 1 : 0),
    lastEvidenceId: evidenceId,
    lastScore: round(score),
  }

  appendActiveRule(resolution, { id: 'TUTOR_UNCERTAINTY_AWARE_KT', priority: 1100, rationale: '用可解释 Beta posterior 表示掌握度与证据不足带来的不确定性。' })
  stateMutation(resolution, 'TUTOR_UNCERTAINTY_AWARE_KT', skillPath, next, 1100, 'bayes-beta-update')
  stateMutation(resolution, 'TUTOR_UNCERTAINTY_AWARE_KT', 'learner.currentSkillId', skillId, 1100)
  stateMutation(resolution, 'TUTOR_UNCERTAINTY_AWARE_KT', 'learner.currentSkillKey', skillKey, 1100)
  stateMutation(resolution, 'TUTOR_UNCERTAINTY_AWARE_KT', 'learner.evidenceIds', [...seen, evidenceId], 1100, 'appendUnique')

  const misconception = updateMisconception(resolution, { ...payload, evidenceId }, evidence, score)
  const policy = policyFor(next, misconception)
  appendActiveRule(resolution, { id: 'TUTOR_POLICY_FROM_KNOWLEDGE_STATE', priority: 900, rationale: '教学策略由掌握度、不确定性和错误概念证据共同决定。' })
  stateMutation(resolution, 'TUTOR_POLICY_FROM_KNOWLEDGE_STATE', 'pedagogy.recommendedMode', policy.mode, 900)
  stateMutation(resolution, 'TUTOR_POLICY_FROM_KNOWLEDGE_STATE', 'pedagogy.hintLevel', policy.hintLevel, 900)
  stateMutation(resolution, 'TUTOR_POLICY_FROM_KNOWLEDGE_STATE', 'pedagogy.policyReason', policy.reason, 900)
  stateMutation(resolution, 'TUTOR_POLICY_FROM_KNOWLEDGE_STATE', 'task.recommendedDifficulty', recommendedDifficulty(next), 900)

  if (evidence.assisted && score >= 0.5) {
    appendResolutionDiagnostic(resolution, { severity: 'info', code: 'TUTOR_ASSISTED_SUCCESS_DOWNWEIGHTED', message: '使用提示/揭示答案后的正确结果被保留，但不会按独立掌握证据同权计入。' })
  }
  if (score < 0.5 && evidence.assistanceUsed) {
    appendResolutionDiagnostic(resolution, { severity: 'info', code: 'TUTOR_ASSISTED_FAILURE_PRESERVED', message: '首答错误/需要帮助被保留为尚未独立掌握的负证据；assistance 不会像成功证据那样对称削弱。' })
  }
  if (evidence.weight < 0.35) {
    appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'TUTOR_LOW_EVIDENCE_WEIGHT', message: `本次 observation weight=${evidence.weight}，不足以支撑强掌握结论。` })
  }
  appendResolutionArtifact(resolution, {
    type: 'tutor-evidence', evidenceId, accepted: true, skillId, score: round(score), ...evidence,
    posterior: stats, source: clone(payload.source || payload.assessment?.source),
  })
}

function handleAffect(resolution, event) {
  const payload = event.payload || {}
  const observerConfidence = clamp(payload.observerConfidence ?? 0)
  appendActiveRule(resolution, { id: 'TUTOR_AFFECT_OBSERVATION_GATE', priority: 1080, rationale: '情绪/信心只由显式且有置信度的观察更新，不能从答错直接推断。' })
  if (observerConfidence < 0.60) {
    appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'TUTOR_AFFECT_LOW_CONFIDENCE_REJECTED', message: '情感观察置信度低于 0.60，拒绝写入长期学习者状态。' })
    return
  }
  if (typeof payload.confidence === 'number') stateMutation(resolution, 'TUTOR_AFFECT_OBSERVATION_GATE', 'learner.affect.confidence', clamp(payload.confidence), 1080)
  if (typeof payload.frustration === 'number') stateMutation(resolution, 'TUTOR_AFFECT_OBSERVATION_GATE', 'learner.affect.frustration', clamp(payload.frustration), 1080)
  stateMutation(resolution, 'TUTOR_AFFECT_OBSERVATION_GATE', 'learner.affect.observerConfidence', observerConfidence, 1080)
  stateMutation(resolution, 'TUTOR_AFFECT_OBSERVATION_GATE', 'learner.affect.source', String(payload.source || 'observer'), 1080)
}

function handleIntervention(resolution, event) {
  const payload = event.payload || {}
  const id = String(payload.interventionId || event.id || '').trim()
  if (!id) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'TUTOR_INTERVENTION_ID_REQUIRED', message: 'INTERVENTION_APPLIED 需要 interventionId。' })
    return
  }
  const history = getPath(resolution.resolvedState, 'pedagogy.interventions') || []
  if (history.some(x => x.id === id)) {
    appendResolutionDiagnostic(resolution, { severity: 'warning', code: 'TUTOR_DUPLICATE_INTERVENTION_IGNORED', message: `interventionId ${id} 已存在。` })
    return
  }
  const row = {
    id,
    strategy: payload.strategy || getPath(resolution.resolvedState, 'pedagogy.recommendedMode') || 'unknown',
    skillId: payload.skillId || getPath(resolution.resolvedState, 'learner.currentSkillId') || 'unknown',
    hintLevel: payload.hintLevel ?? getPath(resolution.resolvedState, 'pedagogy.hintLevel') ?? 0,
    rationale: payload.rationale || null,
  }
  appendActiveRule(resolution, { id: 'TUTOR_INTERVENTION_LEDGER', priority: 1000, rationale: '教学干预必须可追踪，后续 verifier 才能判断是否有效。' })
  stateMutation(resolution, 'TUTOR_INTERVENTION_LEDGER', 'pedagogy.interventions', [...history, row], 1000, 'append')
  stateMutation(resolution, 'TUTOR_INTERVENTION_LEDGER', 'pedagogy.lastIntervention', row, 1000)
  appendResolutionArtifact(resolution, { type: 'tutor-intervention', ...row })
}

function handleVerifier(resolution, event) {
  const payload = event.payload || {}
  const id = String(payload.interventionId || '').trim()
  const history = getPath(resolution.resolvedState, 'pedagogy.interventions') || []
  const intervention = history.find(x => x.id === id)
  appendActiveRule(resolution, { id: 'TUTOR_TURN_VERIFIER', priority: 1060, rationale: '将“学生状态估计”和“本轮教学干预是否有效”分离记录。' })
  if (!intervention) {
    appendResolutionDiagnostic(resolution, { severity: 'error', code: 'TUTOR_VERIFIER_ORPHAN', message: `找不到 interventionId ${id}，拒绝生成伪造干预效果。` })
    return
  }
  const outcome = ['progress', 'neutral', 'regress'].includes(payload.outcome) ? payload.outcome : 'neutral'
  const confidence = clamp(payload.confidence ?? 0.7)
  const score = outcome === 'progress' ? 1 : outcome === 'regress' ? 0 : 0.5
  const verifier = clone(getPath(resolution.resolvedState, 'pedagogy.verifier') || { verified: 0, progress: 0, neutral: 0, regress: 0, effectiveness: 0.5 })
  verifier.verified += 1
  verifier[outcome] = Number(verifier[outcome] || 0) + 1
  verifier.effectiveness = round(Number(verifier.effectiveness ?? 0.5) * 0.75 + score * confidence * 0.25 + (1 - confidence) * 0.5 * 0.25)
  verifier.last = { interventionId: id, outcome, confidence }
  stateMutation(resolution, 'TUTOR_TURN_VERIFIER', 'pedagogy.verifier', verifier, 1060, 'verifier-update')
  appendResolutionArtifact(resolution, { type: 'tutor-verifier', interventionId: id, outcome, confidence, intervention })
}

export function resolveTutorEvent(profile, baseState, event, context = {}) {
  const resolution = resolveProfileEventGeneric(profile, baseState, event, context)
  if (event.type === 'LEARNER_OBSERVATION') handleObservation(profile, resolution, event)
  else if (event.type === 'AFFECT_OBSERVED') handleAffect(resolution, event)
  else if (event.type === 'INTERVENTION_APPLIED') handleIntervention(resolution, event)
  else if (event.type === 'TURN_VERIFIED') handleVerifier(resolution, event)
  return refreshResolution(profile, resolution)
}

export function summarizeTutorState(state) {
  const key = getPath(state, 'learner.currentSkillKey')
  const model = key ? getPath(state, `learner.skills.${key}`) : undefined
  return {
    currentSkillId: getPath(state, 'learner.currentSkillId'),
    model: clone(model),
    policy: {
      mode: getPath(state, 'pedagogy.recommendedMode'),
      hintLevel: getPath(state, 'pedagogy.hintLevel'),
      reason: getPath(state, 'pedagogy.policyReason'),
      recommendedDifficulty: getPath(state, 'task.recommendedDifficulty'),
    },
    misconceptions: clone(getPath(state, 'learner.misconceptions') || {}),
    verifier: clone(getPath(state, 'pedagogy.verifier') || {}),
  }
}

export function tutorStateFingerprint(state) {
  return stableStringify(summarizeTutorState(state))
}
