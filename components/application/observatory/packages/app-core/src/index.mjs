export const APP_SESSION_SCHEMAS = new Set(['ppl.app-session/0.1', 'ppl.app-session/0.2', 'ppl.app-session/0.3', 'ppl.app-session/0.4'])
export const APP_LIFECYCLE_AUDIT_SCHEMA = 'ppl.app-lifecycle-audit/0.1'
export const PERSONA_SNAPSHOT_SCHEMA = 'ppl.host-snapshot/0.1'
export const PROFILE_SNAPSHOT_SCHEMAS = new Set(['ppl.profile-snapshot/0.1', 'ppl.profile-snapshot/0.2'])
export const PROFILE_SNAPSHOT_SCHEMA = 'ppl.profile-snapshot/0.2'
export const COMMIT_END_REASONS = new Set(['completed', 'max-tokens'])

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

export function contentHash(value) {
  const text = stableStringify(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function flatten(value, prefix = '', rows = new Map()) {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) rows.set(prefix, value)
    return rows
  }
  const entries = Object.entries(value)
  if (!entries.length && prefix) rows.set(prefix, value)
  for (const [key, child] of entries) flatten(child, prefix ? `${prefix}.${key}` : key, rows)
  return rows
}

export function sameValue(a, b) {
  if (Object.is(a, b)) return true
  try { return stableStringify(a) === stableStringify(b) } catch { return false }
}

export function snapshotKind(entry) {
  const schema = entry?.snapshot?.schema
  if (schema === PERSONA_SNAPSHOT_SCHEMA) return 'persona'
  if (PROFILE_SNAPSHOT_SCHEMAS.has(schema)) return 'profile'
  return entry?.kind || 'unknown'
}

export function stateRoot(entry) {
  const kind = snapshotKind(entry)
  if (kind === 'persona') return entry.snapshot?.resolution?.resolved || {}
  if (kind === 'profile') return entry.snapshot?.resolution?.resolvedState || {}
  return {}
}

export function baseStateRoot(entry) {
  const kind = snapshotKind(entry)
  if (kind === 'profile') return entry.snapshot?.resolution?.baseState || {}
  return {}
}

export function mutationStatus(entry) {
  const explicit = entry?.snapshot?.transaction?.status
  if (['applied', 'discarded', 'pending'].includes(explicit)) return explicit
  if (!entry?.endReason) return 'pending'
  return COMMIT_END_REASONS.has(entry.endReason) ? 'applied' : 'discarded'
}

export function eventLabel(entry) {
  const event = entry?.snapshot?.event || {}
  return [event.type || event.kind || 'UNKNOWN', event.category].filter(Boolean).join(' · ')
}

export function entityMeta(entry) {
  const kind = snapshotKind(entry)
  if (kind === 'persona') {
    const p = entry.snapshot?.persona || {}
    return { kind, id: p.id || 'unknown-persona', title: p.id || 'Persona', version: p.version, fingerprint: p.irSha256 || p.fingerprint }
  }
  if (kind === 'profile') {
    const p = entry.snapshot?.profile || {}
    return { kind, id: p.id || 'unknown-profile', title: p.title || p.id || 'Profile', version: p.version, fingerprint: p.fingerprint }
  }
  return { kind: 'unknown', id: 'unknown', title: 'Unknown' }
}

export function entryKey(entry) {
  const host = entry?.snapshot?.host || {}
  return `${Number(host.turn || 0).toString().padStart(8, '0')}:${Number(host.step || 0).toString().padStart(8, '0')}:${Number(entry?.snapshotSeq || 0).toString().padStart(8, '0')}`
}

export function normalizeSession(session) {
  const normalized = clone(session)
  normalized.schema ||= 'ppl.app-session/0.2'
  normalized.entries = [...(normalized.entries || [])].map((entry, index) => ({ snapshotSeq: entry.snapshotSeq ?? index + 1, ...entry }))
    .sort((a, b) => entryKey(a).localeCompare(entryKey(b)))
  return normalized
}

export function validateSession(session) {
  if (!isRecord(session)) return ['根对象必须是 object']
  const errors = []
  if (!APP_SESSION_SCHEMAS.has(session.schema)) errors.push('schema 必须是 ppl.app-session/0.1、0.2、0.3 或 0.4')
  if (!Array.isArray(session.entries)) return [...errors, 'entries 必须是数组']
  if (session.lifecycle !== undefined) {
    if (!isRecord(session.lifecycle)) errors.push('lifecycle 必须是 object')
    else {
      if (session.lifecycle.schema !== APP_LIFECYCLE_AUDIT_SCHEMA) errors.push('lifecycle.schema 必须是 ppl.app-lifecycle-audit/0.1')
      for (const key of ['turnAudits','restartMarkers','toolExecutions','recoverableTurns']) {
        if (session.lifecycle[key] !== undefined && !Array.isArray(session.lifecycle[key])) errors.push(`lifecycle.${key} 必须是数组`)
      }
      for (const [i,row] of (session.lifecycle.turnAudits || []).entries()) {
        if (!Number.isInteger(row?.turn)) errors.push(`lifecycle.turnAudits[${i}] 缺少 turn`)
        if (!row?.status) errors.push(`lifecycle.turnAudits[${i}] 缺少 status`)
      }
    }
  }
  session.entries.forEach((entry, i) => {
    const snapshot = entry?.snapshot
    if (!(snapshot?.schema === PERSONA_SNAPSHOT_SCHEMA || PROFILE_SNAPSHOT_SCHEMAS.has(snapshot?.schema))) errors.push(`entries[${i}].snapshot.schema 不受支持`)
    if (!Number.isInteger(snapshot?.host?.turn) || !Number.isInteger(snapshot?.host?.step)) errors.push(`entries[${i}] 缺少 host.turn/step`)
    if (snapshot?.schema === PERSONA_SNAPSHOT_SCHEMA && !snapshot?.persona?.id) errors.push(`entries[${i}] 缺少 persona.id`)
    if (PROFILE_SNAPSHOT_SCHEMAS.has(snapshot?.schema) && !snapshot?.profile?.id) errors.push(`entries[${i}] 缺少 profile.id`)
  })
  return errors
}

export function snapshotDiff(current, previous) {
  if (!previous) return []
  const now = flatten(stateRoot(current))
  const before = flatten(stateRoot(previous))
  const paths = [...new Set([...now.keys(), ...before.keys()])].sort()
  return paths.flatMap(path => {
    const hasNow = now.has(path)
    const hasBefore = before.has(path)
    if (!hasBefore && hasNow) return [{ path, before: undefined, after: now.get(path), kind: 'added' }]
    if (hasBefore && !hasNow) return [{ path, before: before.get(path), after: undefined, kind: 'removed' }]
    if (!sameValue(before.get(path), now.get(path))) return [{ path, before: before.get(path), after: now.get(path), kind: 'changed' }]
    return []
  })
}

export function activeRules(entry) {
  return entry?.snapshot?.resolution?.activeRules || []
}

export function mutations(entry) {
  const status = mutationStatus(entry)
  const snapshot = entry?.snapshot || {}
  if (PROFILE_SNAPSHOT_SCHEMAS.has(snapshot.schema)) {
    return (snapshot.resolution?.mutations || []).map(x => ({
      kind: 'state', source: x.source || 'profile-rule', path: x.path || 'unknown', from: x.before, to: x.after, op: x.op, status,
    }))
  }
  const resolution = snapshot.resolution || {}
  return [
    ...(resolution.pendingCommits || []).map(x => ({ kind: 'commit', source: x.source || 'commit', path: x.path || 'unknown', from: x.from, to: x.projected ?? x.value, status })),
    ...(resolution.pendingTransitions || []).map(x => ({ kind: 'transition', source: x.source || 'transition', path: x.path || 'unknown', from: x.from, to: x.to, status })),
  ]
}

export function changedTraces(entry) {
  const trace = entry?.snapshot?.resolution?.trace || {}
  return Object.entries(trace).flatMap(([path, raw]) => {
    if (!isRecord(raw)) return []
    const steps = (raw.steps || []).map(step => ({
      rule: step.rule || 'unknown-rule', priority: step.priority, op: step.op || '?', value: step.value,
      before: step.before, after: step.after,
    }))
    const base = raw.base ?? raw.before
    const final = raw.final ?? raw.after
    if (base === undefined && final === undefined && !steps.length) return []
    if (sameValue(base, final) && !steps.some(step => !sameValue(step.before, step.after))) return []
    return [{ path: raw.path || path, base, final, delta: raw.delta, magnitude: raw.deltaMagnitude, steps }]
  }).sort((a, b) => Math.abs(Number(b.delta || 0)) - Math.abs(Number(a.delta || 0)))
}

export function ruleImpacts(entry) {
  const map = new Map()
  const ensure = (id, priority, active = false) => {
    if (!map.has(id)) map.set(id, { id, priority, active, paths: new Set(), provenance: 0, mutations: 0 })
    const row = map.get(id)
    row.active ||= active
    if (row.priority === undefined && priority !== undefined) row.priority = priority
    return row
  }
  for (const rule of activeRules(entry)) ensure(rule.id, rule.priority, true)
  for (const trace of changedTraces(entry)) {
    for (const step of trace.steps) {
      const row = ensure(step.rule, step.priority)
      row.paths.add(trace.path)
      row.provenance += 1
    }
  }
  for (const mutation of mutations(entry)) {
    const row = ensure(mutation.source)
    row.paths.add(mutation.path)
    row.mutations += 1
  }
  return [...map.values()].map(x => ({ ...x, paths: [...x.paths].sort() })).sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || a.id.localeCompare(b.id))
}

export function getPath(entry, path) {
  return flatten(stateRoot(entry)).get(path)
}

export function series(entries, path) {
  return entries.map(entry => ({
    turn: entry.snapshot?.host?.turn,
    step: entry.snapshot?.host?.step,
    value: getPath(entry, path),
    status: mutationStatus(entry),
  })).filter(point => typeof point.value === 'number' || typeof point.value === 'boolean')
}

export function listNumericPaths(entries) {
  const paths = new Set()
  for (const entry of entries) {
    for (const [path, value] of flatten(stateRoot(entry))) if (typeof value === 'number') paths.add(path)
  }
  return [...paths].sort()
}

export function defaultMetrics(session) {
  const configured = session?.observability?.metrics
  if (Array.isArray(configured) && configured.length) return configured.slice(0, 8)
  const entries = session?.entries || []
  const preferred = [
    ['relationships.admin.trust', '信任', '关系强度'],
    ['traits.emotional_guard', '情绪防御', '越低越放松'],
    ['traits.vulnerability', '脆弱表达', '越高越愿意袒露'],
    ['style.formality', '正式度', '交互风格'],
  ].filter(([path]) => entries.some(entry => getPath(entry, path) !== undefined))
  if (preferred.length) return preferred.map(([path, label, hint]) => ({ path, label, hint }))
  return listNumericPaths(entries).slice(0, 4).map(path => ({ path, label: path.split('.').at(-1), hint: path }))
}

export function sessionOverview(session) {
  const entries = session?.entries || []
  const statuses = { applied: 0, discarded: 0, pending: 0 }
  const uniqueRules = new Set()
  let diagnostics = 0
  let changedPaths = 0
  let committedMutations = 0
  entries.forEach((entry, index) => {
    statuses[mutationStatus(entry)] += 1
    activeRules(entry).forEach(rule => uniqueRules.add(rule.id))
    diagnostics += entryDiagnostics(entry).length
    changedPaths += snapshotDiff(entry, index ? entries[index - 1] : undefined).length
    committedMutations += mutations(entry).filter(x => x.status === 'applied' && !sameValue(x.from, x.to)).length
  })
  return {
    snapshots: entries.length,
    statuses,
    uniqueRules: uniqueRules.size,
    diagnostics,
    changedPaths,
    committedMutations,
    entities: [...new Set(entries.map(entry => entityMeta(entry).id))].length,
  }
}

export function ruleStatistics(session) {
  const map = new Map()
  for (const entry of session?.entries || []) {
    const status = mutationStatus(entry)
    const impacts = new Map(ruleImpacts(entry).map(row => [row.id, row]))
    for (const rule of activeRules(entry)) {
      if (!map.has(rule.id)) map.set(rule.id, { id: rule.id, hits: 0, applied: 0, discarded: 0, pending: 0, paths: new Set(), priorities: new Set() })
      const row = map.get(rule.id)
      row.hits += 1
      row[status] += 1
      if (rule.priority !== undefined) row.priorities.add(rule.priority)
      for (const path of impacts.get(rule.id)?.paths || []) row.paths.add(path)
    }
  }
  return [...map.values()].map(row => ({ ...row, paths: [...row.paths].sort(), priorities: [...row.priorities].sort((a,b)=>b-a) }))
    .sort((a, b) => b.hits - a.hits || a.id.localeCompare(b.id))
}

export function causalChain(entry) {
  const impacts = ruleImpacts(entry)
  const muts = mutations(entry)
  const impactByRule = new Map(impacts.map(x => [x.id, x.paths]))
  return {
    turn: entry?.snapshot?.host?.turn,
    step: entry?.snapshot?.host?.step,
    event: entry?.snapshot?.event || {},
    status: mutationStatus(entry),
    rules: activeRules(entry).map(rule => ({ id: rule.id, priority: rule.priority, paths: impactByRule.get(rule.id) || [] })),
    mutations: muts,
    diagnostics: entryDiagnostics(entry),
  }
}

export function sessionCausalChains(session) {
  return (session?.entries || []).map(causalChain)
}

export function entryDiagnostics(entry) {
  const snapshot = entry?.snapshot || {}
  const diagnostics = []
  if (snapshot.resolution?.valid === false) diagnostics.push({ severity: 'error', code: 'RESOLUTION_INVALID', message: '该 Snapshot 的 resolution.valid=false' })
  for (const item of snapshot.resolution?.diagnostics || []) diagnostics.push(clone(item))
  if (entry?.endError) diagnostics.push({ severity: 'error', code: 'TURN_END_ERROR', message: typeof entry.endError === 'string' ? entry.endError : stableStringify(entry.endError) })
  if (mutationStatus(entry) === 'discarded' && mutations(entry).some(x => !sameValue(x.from, x.to))) diagnostics.push({ severity: 'info', code: 'ROLLED_BACK_MUTATION', message: '本轮存在 projected mutation，但终态要求回滚。' })
  return diagnostics
}

export function sessionDiagnostics(session) {
  const rows = []
  const byEntity = new Map()
  for (const entry of session?.entries || []) {
    const meta = entityMeta(entry)
    const key = `${meta.kind}:${meta.id}`
    if (!byEntity.has(key)) byEntity.set(key, new Set())
    if (meta.fingerprint) byEntity.get(key).add(meta.fingerprint)
    for (const diagnostic of entryDiagnostics(entry)) rows.push({ turn: entry.snapshot?.host?.turn, step: entry.snapshot?.host?.step, entity: meta.id, ...diagnostic })
  }
  for (const [entity, fingerprints] of byEntity) {
    if (fingerprints.size > 1) rows.push({ severity: 'warning', code: 'FINGERPRINT_CHANGED', entity, message: `同一 Session 中检测到 ${fingerprints.size} 个 fingerprint。` })
  }
  return rows
}

export function stateGroups(session, entry) {
  const configured = session?.observability?.groups
  const flat = flatten(stateRoot(entry))
  if (Array.isArray(configured) && configured.length) {
    return configured.map(group => ({
      ...group,
      rows: [...flat.entries()].filter(([path]) => path.startsWith(group.prefix || '')).map(([path, value]) => ({ path, value })),
    }))
  }
  const prefixes = new Map()
  for (const [path, value] of flat) {
    const prefix = path.split('.')[0]
    if (!prefixes.has(prefix)) prefixes.set(prefix, [])
    prefixes.get(prefix).push({ path, value })
  }
  return [...prefixes].map(([id, rows]) => ({ id, label: id, prefix: `${id}.`, rows }))
}


export function readStatePath(entry, path) {
  const keys = String(path || '').split('.').filter(Boolean)
  let value = stateRoot(entry)
  for (const key of keys) {
    if (value === null || value === undefined) return undefined
    value = value[key]
  }
  return value
}

export function domainKind(session, entry) {
  if (snapshotKind(entry) !== 'profile') return 'persona'
  return session?.domain?.profileKind || entry?.snapshot?.profile?.kind || session?.profile?.kind || 'profile'
}

export function domainArtifacts(entry, type) {
  const rows = entry?.snapshot?.resolution?.artifacts || []
  return type ? rows.filter(row => row?.type === type) : rows
}

export function tutorDomainSummary(entry) {
  const currentKey = readStatePath(entry, 'learner.currentSkillKey')
  const model = currentKey ? readStatePath(entry, `learner.skills.${currentKey}`) : undefined
  const misconceptions = readStatePath(entry, 'learner.misconceptions') || {}
  return {
    skillId: readStatePath(entry, 'learner.currentSkillId'),
    model: clone(model),
    policy: {
      mode: readStatePath(entry, 'pedagogy.recommendedMode'),
      hintLevel: readStatePath(entry, 'pedagogy.hintLevel'),
      reason: readStatePath(entry, 'pedagogy.policyReason'),
      recommendedDifficulty: readStatePath(entry, 'task.recommendedDifficulty'),
    },
    verifier: clone(readStatePath(entry, 'pedagogy.verifier') || {}),
    misconceptions: Object.values(misconceptions),
    evidence: domainArtifacts(entry, 'tutor-evidence'),
    latestEvidence: clone(domainArtifacts(entry, 'tutor-evidence').at(-1)),
    evidenceAccounting: {
      observations: Number(model?.observations || 0),
      directAssessments: Number(model?.directAssessments || 0),
      assistedAssessments: Number(model?.assistedAssessments || 0),
      unaidedSuccesses: Number(model?.unaidedSuccesses || 0),
      firstAttemptFailures: Number(model?.firstAttemptFailures || 0),
      assistanceEpisodes: Number(model?.assistanceEpisodes || 0),
    },
    interventions: clone(readStatePath(entry, 'pedagogy.interventions') || []),
  }
}

export function researchDomainSummary(entry) {
  const activeClaimId = readStatePath(entry, 'research.activeClaimId')
  const key = String(activeClaimId || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const claim = key ? readStatePath(entry, `research.claims.${key}`) : undefined
  return {
    question: readStatePath(entry, 'research.question'),
    activeClaimId,
    claim: clone(claim),
    evidenceLedger: clone(readStatePath(entry, 'research.evidenceLedger') || []),
    validationLedger: clone(readStatePath(entry, 'research.validationLedger') || []),
    conclusionStatus: readStatePath(entry, 'research.conclusionStatus'),
    conclusionDirection: readStatePath(entry, 'research.conclusionDirection') || claim?.decision?.direction || 'undetermined',
    conflict: clone(claim?.conflict || claim?.decision?.conflict),
    nextAction: readStatePath(entry, 'workflow.nextAction'),
    artifacts: domainArtifacts(entry),
  }
}


export function tutorLearnerTrajectory(session) {
  const normalized = normalizeSession(session)
  const points = []
  const finalBySkill = new Map()
  for (const entry of normalized.entries || []) {
    if (domainKind(normalized, entry) !== 'tutor') continue
    const skillId = readStatePath(entry, 'learner.currentSkillId')
    const currentKey = readStatePath(entry, 'learner.currentSkillKey')
    if (!skillId || !currentKey) continue
    const model = readStatePath(entry, `learner.skills.${currentKey}`) || {}
    const evidence = clone(domainArtifacts(entry, 'tutor-evidence').at(-1))
    const point = {
      turn: entry.snapshot?.host?.turn,
      step: entry.snapshot?.host?.step,
      status: mutationStatus(entry),
      eventType: entry.snapshot?.event?.type || 'UNKNOWN',
      skillId,
      skillKey: currentKey,
      mean: Number.isFinite(Number(model.mean)) ? Number(model.mean) : null,
      uncertainty: Number.isFinite(Number(model.uncertainty)) ? Number(model.uncertainty) : null,
      evidenceWeight: Number.isFinite(Number(model.evidenceWeight)) ? Number(model.evidenceWeight) : 0,
      observations: Number(model.observations || 0),
      directAssessments: Number(model.directAssessments || 0),
      assistedAssessments: Number(model.assistedAssessments || 0),
      unaidedSuccesses: Number(model.unaidedSuccesses || 0),
      firstAttemptFailures: Number(model.firstAttemptFailures || 0),
      assistanceEpisodes: Number(model.assistanceEpisodes || 0),
      evidence: evidence ? {
        evidenceId: evidence.evidenceId,
        score: evidence.score,
        direction: evidence.direction,
        reason: evidence.reason,
        weight: evidence.weight,
        assistanceUsed: evidence.assistanceUsed,
        hints: evidence.hints,
        attempts: evidence.attempts,
      } : null,
      policy: {
        mode: readStatePath(entry, 'pedagogy.recommendedMode'),
        hintLevel: readStatePath(entry, 'pedagogy.hintLevel'),
        recommendedDifficulty: readStatePath(entry, 'task.recommendedDifficulty'),
      },
    }
    points.push(point)
    finalBySkill.set(currentKey, point)
  }
  const skills = [...finalBySkill.values()]
    .map(point => ({
      skillId: point.skillId,
      skillKey: point.skillKey,
      finalMean: point.mean,
      finalUncertainty: point.uncertainty,
      evidenceWeight: point.evidenceWeight,
      observations: point.observations,
      directAssessments: point.directAssessments,
      assistedAssessments: point.assistedAssessments,
      unaidedSuccesses: point.unaidedSuccesses,
      firstAttemptFailures: point.firstAttemptFailures,
      assistanceEpisodes: point.assistanceEpisodes,
    }))
    .sort((a, b) => String(a.skillId).localeCompare(String(b.skillId)))
  return {
    schema: 'ppl.app-tutor-trajectory/0.1',
    points,
    skills,
    summary: {
      points: points.length,
      skills: skills.length,
      assistedPoints: points.filter(x => x.evidence?.assistanceUsed).length,
      masterySupportPoints: points.filter(x => x.evidence?.direction === 'mastery-support').length,
      nonmasterySupportPoints: points.filter(x => x.evidence?.direction === 'nonmastery-support').length,
    },
  }
}

export function researchClaimTrajectory(session, options = {}) {
  const normalized = normalizeSession(session)
  const requestedClaimId = options.claimId ? String(options.claimId) : null
  const points = []
  for (const entry of normalized.entries || []) {
    if (domainKind(normalized, entry) !== 'research') continue
    const activeClaimId = requestedClaimId || readStatePath(entry, 'research.activeClaimId')
    if (!activeClaimId) continue
    const key = String(activeClaimId).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    const claim = readStatePath(entry, `research.claims.${key}`)
    if (!claim) continue
    const decision = claim.decision || {}
    const status = readStatePath(entry, 'research.conclusionStatus') || decision.status || 'blocked'
    const direction = readStatePath(entry, 'research.conclusionDirection') || decision.direction || 'undetermined'
    points.push({
      turn: entry.snapshot?.host?.turn,
      step: entry.snapshot?.host?.step,
      transactionStatus: mutationStatus(entry),
      eventType: entry.snapshot?.event?.type || 'UNKNOWN',
      claimId: activeClaimId,
      claimStatus: claim.status,
      conclusionStatus: status,
      conclusionDirection: direction,
      supportMass: Number(claim.supportMass || 0),
      opposeMass: Number(claim.opposeMass || 0),
      uncertainty: Number(claim.uncertainty ?? 1),
      independentSourceCount: Number(claim.independentSourceCount || 0),
      conflictPresent: Boolean(claim.conflict?.present),
      conflictBalanceRatio: Number(claim.conflict?.balanceRatio || 0),
      strongSupport: Number(claim.validation?.strongSupport || 0),
      strongOppose: Number(claim.validation?.strongOppose || 0),
      validationAttempts: Number(claim.validation?.attempts || 0),
      reasons: clone(decision.reasons || []),
      nextAction: readStatePath(entry, 'workflow.nextAction'),
    })
  }
  const transitions = []
  for (let i = 1; i < points.length; i += 1) {
    const before = points[i - 1]
    const after = points[i]
    if (before.conclusionStatus !== after.conclusionStatus || before.conclusionDirection !== after.conclusionDirection) {
      transitions.push({
        turn: after.turn,
        step: after.step,
        from: `${before.conclusionStatus}/${before.conclusionDirection}`,
        to: `${after.conclusionStatus}/${after.conclusionDirection}`,
        eventType: after.eventType,
      })
    }
  }
  const last = points.at(-1)
  return {
    schema: 'ppl.app-research-trajectory/0.1',
    claimId: requestedClaimId || last?.claimId || null,
    points,
    transitions,
    final: last ? {
      conclusionStatus: last.conclusionStatus,
      conclusionDirection: last.conclusionDirection,
      supportMass: last.supportMass,
      opposeMass: last.opposeMass,
      uncertainty: last.uncertainty,
      strongSupport: last.strongSupport,
      strongOppose: last.strongOppose,
      nextAction: last.nextAction,
    } : null,
  }
}

export function domainAnalytics(session) {
  const normalized = normalizeSession(session)
  const first = normalized.entries?.find(entry => snapshotKind(entry) === 'profile')
  if (!first) return { kind: 'persona' }
  const kind = domainKind(normalized, first)
  if (kind === 'tutor') return { kind, trajectory: tutorLearnerTrajectory(normalized) }
  if (kind === 'research') return { kind, trajectory: researchClaimTrajectory(normalized) }
  return { kind }
}


export function lifecycleAudit(session) {
  const l = isRecord(session?.lifecycle) ? session.lifecycle : {}
  return {
    schema: l.schema || APP_LIFECYCLE_AUDIT_SCHEMA,
    turnAudits: clone(l.turnAudits || []),
    restartMarkers: clone(l.restartMarkers || []),
    toolExecutions: clone(l.toolExecutions || []),
    recoverableTurns: clone(l.recoverableTurns || []),
  }
}

export function lifecycleOverview(session) {
  const l = lifecycleAudit(session)
  const turns = l.turnAudits
  const statuses = {}
  const reasons = {}
  const pids = new Set()
  for (const row of turns) {
    statuses[row.status || 'unknown'] = (statuses[row.status || 'unknown'] || 0) + 1
    if (row.reason) reasons[row.reason] = (reasons[row.reason] || 0) + 1
    if (Number.isInteger(row.pid)) pids.add(row.pid)
  }
  for (const row of l.restartMarkers) if (Number.isInteger(row.pid)) pids.add(row.pid)
  const replayedTools = l.toolExecutions.filter(x => x?.replayed === true || x?.result?.replayed === true || x?.entry?.result?.replayed === true).length
  return {
    turns: turns.length,
    delivered: statuses.delivered || 0,
    blocked: (statuses.blocked || 0) + (statuses.review || 0),
    statuses,
    reasons,
    toolExecutions: l.toolExecutions.length,
    replayedTools,
    restartMarkers: l.restartMarkers.length,
    processCount: pids.size,
    recoverableCheckpoints: l.recoverableTurns.length,
  }
}

export function lifecycleTurnTimeline(session) {
  const l = lifecycleAudit(session)
  return [...l.turnAudits].map((row,index) => ({
    index,
    domain: row.domain || session?.profile?.kind || session?.domain?.profileKind || 'unknown',
    turn: row.turn,
    pid: row.pid ?? null,
    status: row.status || 'unknown',
    reason: row.reason || row.delivery?.reason || null,
    userMessage: row.userMessage || '',
    actionKind: row.action?.kind || row.response?.action?.kind || null,
    delivery: row.delivery || null,
    toolCount: Array.isArray(row.toolResults) ? row.toolResults.length : 0,
    judge: row.audit?.independence?.judge || null,
    agent: row.audit?.independence?.agent || null,
  })).sort((a,b) => Number(a.turn||0)-Number(b.turn||0) || a.index-b.index)
}

export function lifecycleToolSummary(session) {
  const l = lifecycleAudit(session)
  const byName = {}
  const rows = l.toolExecutions.map((row,index) => {
    const result = row?.result || row?.entry?.result || row
    const name = result?.name || row?.name || 'unknown-tool'
    byName[name] = (byName[name] || 0) + 1
    return { index, callId: result?.callId || row?.callId || null, name, replayed: Boolean(result?.replayed || row?.replayed), provenance: result?.provenance || null }
  })
  return { total: rows.length, byName, rows }
}

export function lifecycleRestartTimeline(session) {
  const l = lifecycleAudit(session)
  return [...l.restartMarkers].map((row,index)=>({index, event:row.event||row.type||'restart-marker', segmentId:row.segmentId||row.segment||null, pid:row.pid??null, generatedAt:row.generatedAt||row.at||null})).sort((a,b)=>String(a.generatedAt||'').localeCompare(String(b.generatedAt||'')))
}

export function makeEvidenceBundle(session, options = {}) {
  const normalized = normalizeSession(session)
  const payload = {
    schema: 'ppl.app-evidence-bundle/0.1',
    appVersion: '0.5.0',
    session: normalized,
    overview: sessionOverview(normalized),
    ruleStatistics: ruleStatistics(normalized),
    diagnostics: sessionDiagnostics(normalized),
    causalChains: sessionCausalChains(normalized),
    domainAnalytics: domainAnalytics(normalized),
    metadata: clone(options.metadata || {}),
  }
  return { ...payload, integrity: { algorithm: 'fnv1a32', value: contentHash(payload) } }
}

export function verifyEvidenceBundle(bundle) {
  if (!isRecord(bundle) || bundle.schema !== 'ppl.app-evidence-bundle/0.1') return { passed: false, reason: 'unsupported schema' }
  const { integrity, ...payload } = bundle
  const expected = contentHash(payload)
  return { passed: integrity?.value === expected, expected, actual: integrity?.value }
}
