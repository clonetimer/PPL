import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import {
  validateSession, normalizeSession, snapshotDiff, ruleStatistics, sessionOverview, sessionDiagnostics,
  makeEvidenceBundle, lifecycleOverview, lifecycleTurnTimeline, lifecycleToolSummary, lifecycleRestartTimeline, verifyEvidenceBundle, defaultMetrics, causalChain, mutationStatus,
  domainKind, tutorDomainSummary, researchDomainSummary, tutorLearnerTrajectory, researchClaimTrajectory, domainAnalytics,
} from '../packages/app-core/src/index.mjs'
import { projectDshSession } from '../packages/app-adapter-dsh/src/index.mjs'

async function load(name) { return JSON.parse(await readFile(resolve(`packages/app-standalone/sample/${name}`), 'utf8')) }
const persona = await load('persona-reference.app-session.json')
const tutor = await load('tutor-application-cycle.app-session.json')
const research = await load('research-application-cycle.app-session.json')
const life = await load('life-service-cycle.app-session.json')
const tutorReal70363 = await load('tutor-assistments-70363.app-session.json')
const tutorReal70729 = await load('tutor-assistments-70729.app-session.json')
const researchConflict = await load('research-bilingual-conflict.app-session.json')
const tutorStableNumberLine = await load('tutor-assistments-70363-number-line.app-session.json')
const tutorStableCircle = await load('tutor-assistments-70363-circle-graph.app-session.json')
const researchStableLigo = await load('research-ligo-strong-validation.app-session.json')
const researchStableEgoFlip = await load('research-ego-evidence-flip.app-session.json')
const researchStableEgoRefute = await load('research-ego-strong-refutation.app-session.json')

test('0.4 accepts Persona, legacy Profile and app-session/0.3 domain sessions', () => {
  for (const session of [persona, tutor, research, life, tutorReal70363, tutorReal70729, researchConflict, tutorStableNumberLine, tutorStableCircle, researchStableLigo, researchStableEgoFlip, researchStableEgoRefute]) assert.deepEqual(validateSession(session), [])
  assert.equal(tutor.schema, 'ppl.app-session/0.3')
  assert.equal(research.entries[0].snapshot.schema, 'ppl.profile-snapshot/0.2')
})

test('normalizeSession keeps deterministic Turn+Step ordering', () => {
  const reversed = { ...tutor, entries: [...tutor.entries].reverse() }
  const normalized = normalizeSession(reversed)
  assert.equal(normalized.entries[0].snapshot.host.turn, 1)
  assert.equal(normalized.entries.at(-1).snapshot.host.turn, 10)
})

test('Persona diff remains backward compatible', () => {
  const diff = snapshotDiff(persona.entries[1], persona.entries[0])
  assert.ok(diff.some(x => x.path === 'traits.emotional_guard' && x.after === 0.32))
})

test('Tutor domain summary exposes mastery uncertainty, evidence and verifier', () => {
  const entry = tutor.entries[8]
  const d = tutorDomainSummary(entry)
  assert.equal(domainKind(tutor, entry), 'tutor')
  assert.equal(d.skillId, 'fractions.addition')
  assert.ok(d.model.mean > 0.35 && d.model.mean < 0.7)
  assert.ok(d.model.uncertainty > 0 && d.model.uncertainty < 1)
  assert.equal(d.verifier.verified, 2)
  assert.ok(d.interventions.length >= 2)
})

test('Research domain summary exposes blocked → qualified lifecycle without overstating literature-only validation', () => {
  const before = researchDomainSummary(research.entries[4])
  const after = researchDomainSummary(research.entries[7])
  assert.equal(domainKind(research, research.entries[7]), 'research')
  assert.equal(before.conclusionStatus, 'blocked')
  assert.equal(after.conclusionStatus, 'qualified')
  assert.ok(after.evidenceLedger.length >= 3)
  assert.equal(after.validationLedger.length, 1)
  assert.equal(after.claim.decision.status, 'qualified')
  assert.ok(after.claim.decision.reasons.includes('strong-validation-required'))
})



test('Tutor real ASSISTments sessions expose directional evidence accounting', () => {
  const d1 = tutorDomainSummary(tutorReal70363.entries.at(-1))
  const d2 = tutorDomainSummary(tutorReal70729.entries.at(-1))
  assert.equal(d1.evidenceAccounting.firstAttemptFailures, 2)
  assert.equal(d1.evidenceAccounting.assistanceEpisodes, 2)
  assert.equal(d1.evidenceAccounting.unaidedSuccesses, 4)
  assert.equal(d2.evidenceAccounting.firstAttemptFailures, 2)
  assert.equal(d2.evidenceAccounting.assistanceEpisodes, 2)
  assert.equal(d2.evidenceAccounting.unaidedSuccesses, 3)
  assert.equal(d2.latestEvidence.direction, 'mastery-support')
  const assistedFailure = tutorReal70729.entries[2]
  const dFailure = tutorDomainSummary(assistedFailure)
  assert.equal(dFailure.latestEvidence.direction, 'nonmastery-support')
  assert.equal(dFailure.latestEvidence.reason, 'bottom-hint-or-answer-reveal-needed')
  assert.ok(dFailure.latestEvidence.weight >= 0.85)
})

test('Research conflict session renders a first-class inconclusive decision', () => {
  const d = researchDomainSummary(researchConflict.entries.at(-1))
  assert.equal(d.conclusionStatus, 'inconclusive')
  assert.equal(d.claim.decision.status, 'inconclusive')
  assert.equal(d.conflict.present, true)
  assert.ok(d.conflict.balanceRatio >= 0.55)
  assert.ok(d.claim.decision.reasons.includes('material-conflict-unresolved'))
  assert.equal(d.nextAction, 'characterize-conflict-or-run-strong-validation')
})


test('Tutor Stable learner trajectory exposes long real traces without resolver rerun', () => {
  const numberLine = tutorLearnerTrajectory(tutorStableNumberLine)
  const circle = tutorLearnerTrajectory(tutorStableCircle)
  assert.equal(numberLine.points.length, 11)
  assert.equal(circle.points.length, 9)
  assert.equal(numberLine.skills.length, 1)
  assert.equal(numberLine.skills[0].skillId, 'Number Line')
  assert.ok(numberLine.summary.assistedPoints >= 5)
  assert.ok(numberLine.points.some(x => x.evidence?.direction === 'nonmastery-support'))
  assert.ok(numberLine.points.some(x => x.evidence?.direction === 'mastery-support'))
  assert.equal(domainAnalytics(tutorStableNumberLine).kind, 'tutor')
  assert.equal(domainAnalytics(tutorStableNumberLine).trajectory.points.length, 11)
})

test('Research Stable trajectory preserves status and direction independently', () => {
  const ligo = researchClaimTrajectory(researchStableLigo)
  assert.ok(ligo.transitions.some(x => x.to === 'ready/support'))
  assert.equal(ligo.final.conclusionStatus, 'ready')
  assert.equal(ligo.final.conclusionDirection, 'support')

  const flip = researchClaimTrajectory(researchStableEgoFlip)
  assert.ok(flip.transitions.some(x => x.to === 'qualified/support'))
  assert.ok(flip.transitions.some(x => x.to === 'inconclusive/mixed'))
  assert.equal(flip.final.conclusionStatus, 'inconclusive')
  assert.equal(flip.final.conclusionDirection, 'mixed')
  assert.ok(flip.final.strongSupport >= 1)
  assert.ok(flip.final.strongOppose >= 2)

  const refute = researchClaimTrajectory(researchStableEgoRefute)
  assert.equal(refute.final.conclusionStatus, 'ready')
  assert.equal(refute.final.conclusionDirection, 'oppose')
  assert.equal(refute.final.nextAction, 'report-refutation')
  assert.equal(domainAnalytics(researchStableEgoRefute).trajectory.final.conclusionDirection, 'oppose')
})

test('Research domain summary exposes conclusion direction for ready support, mixed and ready refutation', () => {
  assert.equal(researchDomainSummary(researchStableLigo.entries.at(-1)).conclusionDirection, 'support')
  assert.equal(researchDomainSummary(researchStableEgoFlip.entries.at(-1)).conclusionDirection, 'mixed')
  assert.equal(researchDomainSummary(researchStableEgoRefute.entries.at(-1)).conclusionDirection, 'oppose')
})

test('domain sessions still use generic overview/rule/diagnostic analytics', () => {
  const overview = sessionOverview(tutor)
  assert.equal(overview.snapshots, 10)
  assert.equal(overview.statuses.discarded, 1)
  assert.ok(overview.uniqueRules >= 4)
  const stats = ruleStatistics(research)
  assert.ok(stats.some(x => x.id === 'RESEARCH_EVIDENCE_LEDGER' && x.hits >= 3))
})

test('Tutor configured metrics include uncertainty and verifier effectiveness', () => {
  const metrics = defaultMetrics(tutor)
  assert.equal(metrics[0].path, 'learner.skills.fractions_addition.mean')
  assert.equal(metrics[1].path, 'learner.skills.fractions_addition.uncertainty')
  assert.ok(metrics.some(x => x.path === 'pedagogy.verifier.effectiveness'))
})

test('Causal chain keeps domain engine rules and state mutations', () => {
  const chain = causalChain(research.entries[4])
  assert.equal(chain.event.type, 'CONCLUSION_REQUESTED')
  assert.ok(chain.rules.some(x => x.id === 'RESEARCH_CONCLUSION_GATE'))
  assert.ok(chain.mutations.some(x => x.path.includes('research.claims.') && x.path.endsWith('.decision') || x.path.includes('research.claims.')))
})

test('Diagnostics expose premature conclusion and rolled-back final Tutor observation', () => {
  const researchRows = sessionDiagnostics(research)
  assert.ok(researchRows.some(x => x.code === 'RESEARCH_PREMATURE_CONCLUSION_BLOCKED'))
  assert.equal(mutationStatus(tutor.entries.at(-1)), 'discarded')
  const tutorRows = sessionDiagnostics(tutor)
  assert.ok(tutorRows.some(x => x.code === 'ROLLED_BACK_MUTATION' && x.turn === 10))
})

test('Evidence bundle remains portable with app-session/0.3', () => {
  const bundle = makeEvidenceBundle(research, { metadata: { suite: 'application-evolution' } })
  assert.equal(bundle.appVersion, '0.5.0')
  assert.equal(verifyEvidenceBundle(bundle).passed, true)
  assert.equal(bundle.domainAnalytics.kind, 'research')
  bundle.overview.snapshots = 999
  assert.equal(verifyEvidenceBundle(bundle).passed, false)
})

test('Optional DSH adapter remains host-isolated and supports Persona snapshots', () => {
  const input = { title: 'DSH export', messages: [
    { role: 'user', source: { kind: 'plugin', plugin: '@ppl/adapter-dsh', ppl: { snapshot: persona.entries[0].snapshot } } },
    { role: 'user', source: { kind: 'plugin', plugin: '@ppl/adapter-dsh', ppl: { snapshot: persona.entries[1].snapshot } } },
  ], events: [{ type: 'turn/end', turn: 1, reason: 'completed' }, { type: 'turn/end', turn: 2, reason: 'completed' }] }
  const projected = projectDshSession(input)
  assert.equal(projected.entries.length, 2)
  assert.deepEqual(validateSession(projected), [])
})


test('Optional DSH adapter projects Profile Snapshot 0.2 into app-session/0.3', () => {
  const snapshot = research.entries[7].snapshot
  assert.equal(snapshot.schema, 'ppl.profile-snapshot/0.2')
  const input = {
    title: 'DSH profile export',
    records: [{ source: { ppl: { snapshot } } }],
    events: [{ type: 'turn/end', turn: snapshot.host.turn, reason: snapshot.transaction.endReason }],
  }
  const projected = projectDshSession(input)
  assert.equal(projected.schema, 'ppl.app-session/0.3')
  assert.equal(projected.profile.kind, 'research')
  assert.equal(projected.domain.engine.id, 'research/evidence-ledger')
  assert.equal(projected.entries[0].kind, 'profile')
  assert.deepEqual(validateSession(projected), [])
  assert.equal(projectDshSession(research).schema, 'ppl.app-session/0.3')
})

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path)); else out.push(path)
  }
  return out
}

test('app-core/app-ui/app-standalone remain host-neutral', async () => {
  for (const pkg of ['app-core', 'app-ui', 'app-standalone']) {
    for (const path of await walk(resolve(`packages/${pkg}`))) {
      if (!/\.(mjs|js|json|html|css)$/.test(path)) continue
      const text = await readFile(path, 'utf8')
      assert.equal(text.includes('@deepseek-ai/'), false, `${path} imports DeepSeek Harness`)
    }
  }
})


test('app-session/0.4 accepts lifecycle sidecars without changing snapshot semantics', () => {
  const session = {
    ...tutor,
    schema: 'ppl.app-session/0.4',
    lifecycle: {
      schema: 'ppl.app-lifecycle-audit/0.1',
      turnAudits: [
        { domain:'tutor', turn:1, pid:101, status:'delivered', reason:null, action:{kind:'tutor-intervention'}, toolResults:[] },
        { domain:'tutor', turn:2, pid:202, status:'blocked', reason:'policy-violation', action:null, toolResults:[] },
      ],
      restartMarkers: [{event:'segment-start',segmentId:'b',pid:202,generatedAt:'2026-08-20T00:00:00Z'}],
      toolExecutions: [{callId:'c1',result:{callId:'c1',name:'lookup',replayed:false}}],
      recoverableTurns: [{turnId:'t1',checkpoint:{phase:'committed'}}],
    },
  }
  assert.deepEqual(validateSession(session), [])
  assert.equal(sessionOverview(session).snapshots, tutor.entries.length)
  const o=lifecycleOverview(session); assert.equal(o.turns,2); assert.equal(o.delivered,1); assert.equal(o.blocked,1); assert.equal(o.toolExecutions,1); assert.equal(o.processCount,2)
  assert.equal(lifecycleTurnTimeline(session)[1].reason,'policy-violation')
  assert.equal(lifecycleToolSummary(session).rows[0].name,'lookup')
  assert.equal(lifecycleRestartTimeline(session)[0].pid,202)
})

test('legacy app-session/0.3 remains lifecycle-empty and valid', () => {
  assert.deepEqual(validateSession(tutor), [])
  const o=lifecycleOverview(tutor); assert.equal(o.turns,0); assert.equal(o.toolExecutions,0)
})
