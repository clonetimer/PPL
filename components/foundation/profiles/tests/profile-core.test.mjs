import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  validateProfile, toAppSession, finalizeProfileResolution, fingerprintProfile, getPath,
  PROFILE_SNAPSHOT_SCHEMA,
} from '../packages/profile-core/src/index.mjs'
import { resolveProfileEvent, runProfileScenario } from '../packages/profile-runtime/src/index.mjs'
import { assistmentsCsvToScenario, assistmentsRowToEvent, summarizeAssistmentsCsv } from '../packages/profile-tutor/src/adapters/assistments.mjs'
import { assessmentEvidenceWeight, canonicalSkillKey } from '../packages/profile-tutor/src/index.mjs'
import { runBktTrace, compareTutorToBkt } from '../packages/profile-tutor/src/bkt.mjs'

async function load(path) { return JSON.parse(await readFile(resolve(path), 'utf8')) }
const profiles = Object.fromEntries(await Promise.all(['character', 'tutor', 'research', 'life'].map(async kind => [kind, await load(`profiles/${kind}/profile.json`)])))

test('all four profiles validate with mixed 0.1/0.2 compatibility', () => {
  for (const [kind, profile] of Object.entries(profiles)) assert.deepEqual(validateProfile(profile), [], kind)
})

test('profile fingerprint remains deterministic', () => {
  assert.equal(fingerprintProfile(profiles.tutor), fingerprintProfile(JSON.parse(JSON.stringify(profiles.tutor))))
})

test('Tutor weights assisted success below direct first-attempt evidence', () => {
  const direct = assessmentEvidenceWeight({ correct: true, sourceReliability: 0.9, assessment: { attemptCount: 1, hintCount: 0 } }, 1)
  const assisted = assessmentEvidenceWeight({ correct: true, sourceReliability: 0.9, assessment: { attemptCount: 2, hintCount: 2 } }, 1)
  assert.equal(direct.weight, 0.9)
  assert.equal(assisted.weight, 0.27)
  assert.ok(assisted.weight < direct.weight)
})


test('Tutor keeps assistance evidence directional: it downweights success but preserves non-mastery evidence', () => {
  const hintedSuccess = assessmentEvidenceWeight({ sourceReliability: 0.9, assessment: { attemptCount: 2, hintCount: 3, bottomHint: true, answerRevealed: true } }, 1)
  const hintedFailure = assessmentEvidenceWeight({ sourceReliability: 0.9, assessment: { attemptCount: 2, hintCount: 3, bottomHint: true, answerRevealed: true } }, 0)
  assert.equal(hintedSuccess.direction, 'mastery-support')
  assert.equal(hintedSuccess.weight, 0.045)
  assert.equal(hintedFailure.direction, 'nonmastery-support')
  assert.equal(hintedFailure.weight, 0.855)
  assert.ok(hintedFailure.weight > hintedSuccess.weight * 10)
})

test('Tutor uncertainty-aware update accumulates evidence without equating one correct answer to mastery', () => {
  const base = structuredClone(profiles.tutor.initialState)
  const r = resolveProfileEvent(profiles.tutor, base, {
    id: 'obs-1', type: 'LEARNER_OBSERVATION', payload: {
      evidenceId: 'obs-1', skillId: 'fractions.addition', correct: true, sourceReliability: 0.9,
      assessment: { attemptCount: 1, hintCount: 0 },
    },
  })
  const model = getPath(r.resolvedState, 'learner.skills.fractions_addition')
  assert.ok(model.mean > 0.3333 && model.mean < 0.6)
  assert.ok(model.uncertainty < 0.7127)
  assert.equal(model.directAssessments, 1)
  assert.ok(r.activeRules.some(x => x.id === 'TUTOR_UNCERTAINTY_AWARE_KT'))
})

test('Tutor duplicate evidence is idempotent', () => {
  const base = structuredClone(profiles.tutor.initialState)
  const first = resolveProfileEvent(profiles.tutor, base, { id: 'dup', type: 'LEARNER_OBSERVATION', payload: { evidenceId: 'dup', skillId: 'fractions.addition', correct: false, assessment: { hintCount: 0, attemptCount: 1 } } })
  const second = resolveProfileEvent(profiles.tutor, first.resolvedState, { id: 'dup', type: 'LEARNER_OBSERVATION', payload: { evidenceId: 'dup', skillId: 'fractions.addition', correct: false, assessment: { hintCount: 0, attemptCount: 1 } } })
  assert.deepEqual(getPath(second.resolvedState, 'learner.skills.fractions_addition'), getPath(first.resolvedState, 'learner.skills.fractions_addition'))
  assert.ok(second.diagnostics.some(x => x.code === 'TUTOR_DUPLICATE_EVIDENCE_IGNORED'))
})

test('Tutor misconception requires accumulated evidence and does not clear on one success', () => {
  let state = structuredClone(profiles.tutor.initialState)
  for (const [id, correct] of [['m1', false], ['m2', false], ['m3', true]]) {
    const r = resolveProfileEvent(profiles.tutor, state, { id, type: 'LEARNER_OBSERVATION', payload: { evidenceId: id, skillId: 'fractions.addition', correct, assessment: { hintCount: 0, attemptCount: 1 }, misconception: { id: 'add-denominators-directly', confidence: 0.9 } } })
    state = r.resolvedState
  }
  const m = getPath(state, 'learner.misconceptions.add_denominators_directly')
  assert.ok(m.support > 1)
  assert.notEqual(m.status, 'resolved')
})

test('Tutor affect state rejects low-confidence inference', () => {
  const r = resolveProfileEvent(profiles.tutor, structuredClone(profiles.tutor.initialState), { type: 'AFFECT_OBSERVED', payload: { frustration: 0.9, observerConfidence: 0.3, source: 'weak-classifier' } })
  assert.equal(getPath(r.resolvedState, 'learner.affect.frustration'), 0.3)
  assert.ok(r.diagnostics.some(x => x.code === 'TUTOR_AFFECT_LOW_CONFIDENCE_REJECTED'))
})

test('Tutor application cycle records intervention verifier and abort rolls back final observation', async () => {
  const scenario = await load('profiles/tutor/scenarios/application-cycle.json')
  const result = runProfileScenario(profiles.tutor, scenario)
  assert.equal(result.entries.at(-1).snapshot.schema, PROFILE_SNAPSHOT_SCHEMA)
  assert.equal(result.entries.at(-1).snapshot.transaction.status, 'discarded')
  assert.equal(getPath(result.finalState, 'pedagogy.verifier.verified'), 2)
  assert.ok(getPath(result.finalState, 'pedagogy.verifier.effectiveness') > 0.5)
  assert.equal(getPath(result.finalState, 'learner.evidenceIds').includes('assistments:1006'), false)
  assert.ok(getPath(result.finalState, 'learner.skills.fractions_addition').evidenceWeight > 2)
})

test('ASSISTments adapter preserves hints/attempts/original provenance', async () => {
  const csv = await readFile(resolve('applications/tutor/assistments-compatible-trace.csv'), 'utf8')
  const scenario = assistmentsCsvToScenario(csv, { userId: 'student_demo' })
  assert.equal(scenario.steps.length, 6)
  assert.equal(scenario.steps[1].event.payload.assessment.hintCount, 2)
  assert.equal(scenario.steps[0].event.payload.provenance.dataset, 'ASSISTments 2009-2010 Skill Builder')
  const event = assistmentsRowToEvent({ order_id: 'x', user_id: 'u', problem_id: 'p', skill_name: 'fractions.addition', original: '0', correct: '1', attempt_count: '1', hint_count: '0' })
  assert.equal(event.payload.sourceReliability, 0.72)
})


test('ASSISTments adapter supports auditable selection, chronological order and dataset inspection', () => {
  const csv = [
    'order_id,user_id,problem_id,skill_name,original,correct,attempt_count,hint_count,first_action,bottom_hint',
    '30,u1,p3,fractions.addition,1,1,1,0,attempt,0',
    '10,u1,p1,fractions.addition,1,0,1,0,attempt,0',
    '20,u1,p2,fractions.addition,0,1,2,1,hint,1',
    '5,u2,p9,fractions.multiplication,1,1,1,0,attempt,0',
  ].join('\n')
  const summary = summarizeAssistmentsCsv(csv)
  assert.equal(summary.rows, 4)
  assert.equal(summary.users, 2)
  assert.equal(summary.skills, 2)
  assert.equal(summary.hintedRows, 1)
  const scenario = assistmentsCsvToScenario(csv, { userId: 'u1', skillId: 'fractions.addition', maxRows: 2 })
  assert.equal(scenario.source.selection.sourceRows, 4)
  assert.equal(scenario.source.selection.selectedRows, 2)
  assert.deepEqual(scenario.steps.map(x => x.event.payload.provenance.rowId), ['10', '20'])
  assert.equal(scenario.steps[1].event.payload.assessment.answerRevealed, true)
})


test('Tutor replays two public corrected ASSISTments traces with hint/multiple-attempt evidence without erasing failure', async () => {
  const csv = await readFile(resolve('applications/tutor/assistments-real-traces.csv'), 'utf8')
  const summary = summarizeAssistmentsCsv(csv)
  assert.deepEqual({ rows: summary.rows, users: summary.users, skills: summary.skills }, { rows: 11, users: 2, skills: 1 })
  assert.equal(summary.hintedRows, 2)
  assert.equal(summary.multipleAttemptRows, 4)
  assert.equal(summary.bottomHintRows, 1)

  const expected = {
    '70363': { steps: 6, mean: 0.4991, uncertainty: 0.5721, evidenceWeight: 5.22, failures: 2, assistance: 2 },
    '70729': { steps: 5, mean: 0.4534, uncertainty: 0.5907, evidenceWeight: 4.365, failures: 2, assistance: 2 },
  }
  for (const [userId, exp] of Object.entries(expected)) {
    const scenario = assistmentsCsvToScenario(csv, { id: `assistments-real-${userId}`, userId, skillId: 'Box and Whisker' })
    assert.equal(scenario.steps.length, exp.steps)
    const result = runProfileScenario(profiles.tutor, scenario)
    const model = getPath(result.finalState, 'learner.skills.box_and_whisker')
    assert.equal(model.mean, exp.mean)
    assert.equal(model.uncertainty, exp.uncertainty)
    assert.equal(model.evidenceWeight, exp.evidenceWeight)
    assert.equal(model.firstAttemptFailures, exp.failures)
    assert.equal(model.assistanceEpisodes, exp.assistance)
    const assistedFailure = result.entries.find(row => row.snapshot.event.payload.correct === false && row.snapshot.event.payload.assessment.hintCount > 0)
    if (assistedFailure) {
      const artifact = assistedFailure.snapshot.resolution.artifacts.find(x => x.type === 'tutor-evidence')
      assert.equal(artifact.direction, 'nonmastery-support')
      assert.ok(artifact.weight >= 0.81)
      assert.ok(assistedFailure.snapshot.resolution.diagnostics.some(x => x.code === 'TUTOR_ASSISTED_FAILURE_PRESERVED'))
    }
  }
})

test('Research generated claim remains proposed/blocked before evidence and validation', () => {
  let state = structuredClone(profiles.research.initialState)
  state = resolveProfileEvent(profiles.research, state, { type: 'QUESTION_DEFINED', payload: { question: 'Q' } }).resolvedState
  const r = resolveProfileEvent(profiles.research, state, { id: 'c1', type: 'CLAIM_PROPOSED', payload: { claimId: 'c1', text: 'H' } })
  assert.equal(getPath(r.resolvedState, 'research.claims.c1.status'), 'proposed')
  assert.equal(getPath(r.resolvedState, 'research.claims.c1.decision.status'), 'blocked')
})

test('Research application blocks premature conclusion and remains qualified after literature-only validation', async () => {
  const scenario = await load('profiles/research/scenarios/application-cycle.json')
  const result = runProfileScenario(profiles.research, scenario)
  const premature = result.entries[4].snapshot
  assert.equal(getPath(premature.resolution.resolvedState, 'research.conclusionStatus'), 'blocked')
  assert.ok(premature.resolution.diagnostics.some(x => x.code === 'RESEARCH_PREMATURE_CONCLUSION_BLOCKED'))
  const afterValidation = result.entries[7].snapshot
  assert.equal(getPath(afterValidation.resolution.resolvedState, 'research.conclusionStatus'), 'qualified')
  assert.equal(getPath(result.finalState, 'research.conclusionStatus'), 'qualified')
  assert.ok(getPath(afterValidation.resolution.resolvedState, 'research.claims.claim_lifecycle_separation.decision.reasons').includes('strong-validation-required'))
  assert.equal(result.entries.at(-1).snapshot.transaction.status, 'discarded')
})


test('Research ready requires strong validation rather than literature triangulation alone', () => {
  let state = structuredClone(profiles.research.initialState)
  state = resolveProfileEvent(profiles.research, state, { id: 'c1', type: 'CLAIM_PROPOSED', payload: { claimId: 'c1', text: 'H' } }).resolvedState
  for (const [id, group] of [['e1','g1'], ['e2','g2']]) {
    state = resolveProfileEvent(profiles.research, state, { id, type: 'EVIDENCE_RECORDED', payload: { evidenceId: id, claimId: 'c1', stance: 'support', source: { title: id, publisher: group, locator: `doi:${id}` }, independenceGroup: group, quality: { relevance: 1, reliability: 1, independence: 1 } } }).resolvedState
  }
  state = resolveProfileEvent(profiles.research, state, { id: 'triangulation', type: 'VALIDATION_RESULT', payload: { validationId: 'triangulation', claimId: 'c1', kind: 'literature-triangulation', outcome: 'support', confidence: 0.9, reproducible: true } }).resolvedState
  let decision = resolveProfileEvent(profiles.research, state, { type: 'CONCLUSION_REQUESTED', payload: { claimId: 'c1' } })
  assert.equal(getPath(decision.resolvedState, 'research.conclusionStatus'), 'qualified')
  state = decision.resolvedState
  state = resolveProfileEvent(profiles.research, state, { id: 'replication', type: 'VALIDATION_RESULT', payload: { validationId: 'replication', claimId: 'c1', kind: 'replication', method: 'independent-replication', outcome: 'support', confidence: 0.9, reproducible: true, provenance: { locator: 'doi:replication' }, artifact: { locator: 'replication-artifact' }, independenceGroup: 'replication-group' } }).resolvedState
  decision = resolveProfileEvent(profiles.research, state, { type: 'CONCLUSION_REQUESTED', payload: { claimId: 'c1' } })
  assert.equal(getPath(decision.resolvedState, 'research.conclusionStatus'), 'ready')
  assert.equal(getPath(decision.resolvedState, 'research.claims.c1.validation.strongSupport'), 1)
})

test('Research correlated source is downweighted and duplicate evidence is rejected', () => {
  let state = structuredClone(profiles.research.initialState)
  state = resolveProfileEvent(profiles.research, state, { id: 'c1', type: 'CLAIM_PROPOSED', payload: { claimId: 'c1', text: 'H' } }).resolvedState
  const e1 = { id: 'e1', type: 'EVIDENCE_RECORDED', payload: { evidenceId: 'e1', claimId: 'c1', stance: 'support', source: { title: 'A', publisher: 'P', locator: 'x' }, independenceGroup: 'g1', quality: { relevance: 1, reliability: 1, independence: 1 } } }
  let r = resolveProfileEvent(profiles.research, state, e1)
  state = r.resolvedState
  const e2 = { id: 'e2', type: 'EVIDENCE_RECORDED', payload: { evidenceId: 'e2', claimId: 'c1', stance: 'support', source: { title: 'A repo', publisher: 'P', locator: 'y' }, independenceGroup: 'g1', quality: { relevance: 1, reliability: 1, independence: 1 } } }
  r = resolveProfileEvent(profiles.research, state, e2)
  assert.ok(r.diagnostics.some(x => x.code === 'RESEARCH_CORRELATED_EVIDENCE_DOWNWEIGHTED'))
  assert.equal(getPath(r.resolvedState, 'research.claims.c1.supportMass'), 1.35)
  const duplicate = resolveProfileEvent(profiles.research, r.resolvedState, e2)
  assert.equal(getPath(duplicate.resolvedState, 'research.claims.c1.supportMass'), 1.35)
  assert.ok(duplicate.diagnostics.some(x => x.code === 'RESEARCH_DUPLICATE_EVIDENCE_IGNORED'))
})

test('Research keeps support and opposition separate and reports qualified rather than ready under conflict', () => {
  let state = structuredClone(profiles.research.initialState)
  state = resolveProfileEvent(profiles.research, state, { id: 'c1', type: 'CLAIM_PROPOSED', payload: { claimId: 'c1', text: 'H' } }).resolvedState
  const sources = [
    ['s1', 'support', 'g1'], ['s2', 'support', 'g2'], ['o1', 'oppose', 'g3'],
  ]
  for (const [id, stance, group] of sources) {
    state = resolveProfileEvent(profiles.research, state, { id, type: 'EVIDENCE_RECORDED', payload: { evidenceId: id, claimId: 'c1', stance, source: { title: id, publisher: group, locator: id }, independenceGroup: group, quality: { relevance: 1, reliability: 1, independence: 1 } } }).resolvedState
  }
  state = resolveProfileEvent(profiles.research, state, { id: 'v1', type: 'VALIDATION_RESULT', payload: { validationId: 'v1', claimId: 'c1', outcome: 'support', confidence: 0.9, reproducible: true, method: 'replication' } }).resolvedState
  const r = resolveProfileEvent(profiles.research, state, { type: 'CONCLUSION_REQUESTED', payload: { claimId: 'c1' } })
  assert.equal(getPath(r.resolvedState, 'research.conclusionStatus'), 'qualified')
  assert.ok(getPath(r.resolvedState, 'research.claims.c1.opposeMass') >= 1)
})



test('Research reports materially balanced support/opposition as inconclusive instead of qualified', () => {
  let state = structuredClone(profiles.research.initialState)
  state = resolveProfileEvent(profiles.research, state, { id: 'c-conflict', type: 'CLAIM_PROPOSED', payload: { claimId: 'c-conflict', text: 'Bilingualism confers a replicable executive-function advantage.' } }).resolvedState
  const rows = [
    ['s1','support','g1',0.8], ['s2','support','g2',0.85],
    ['o1','oppose','g3',0.8], ['o2','oppose','g4',0.9],
  ]
  for (const [id, stance, group, reliability] of rows) {
    state = resolveProfileEvent(profiles.research, state, { id, type: 'EVIDENCE_RECORDED', payload: { evidenceId: id, claimId: 'c-conflict', stance, source: { title: id, publisher: group, locator: `doi:${id}` }, independenceGroup: group, quality: { relevance: 1, reliability, independence: 1 } } }).resolvedState
  }
  state = resolveProfileEvent(profiles.research, state, { id: 'v-lit', type: 'VALIDATION_RESULT', payload: { validationId: 'v-lit', claimId: 'c-conflict', kind: 'literature-triangulation', method: 'cross-source-literature-triangulation', outcome: 'inconclusive', confidence: 0.9, reproducible: true } }).resolvedState
  const r = resolveProfileEvent(profiles.research, state, { type: 'CONCLUSION_REQUESTED', payload: { claimId: 'c-conflict' } })
  assert.equal(getPath(r.resolvedState, 'research.conclusionStatus'), 'inconclusive')
  assert.ok(getPath(r.resolvedState, 'research.claims.c_conflict.conflict.balanceRatio') >= 0.55)
  assert.ok(getPath(r.resolvedState, 'research.claims.c_conflict.decision.reasons').includes('material-conflict-unresolved'))
  assert.equal(getPath(r.resolvedState, 'workflow.nextAction'), 'characterize-conflict-or-run-strong-validation')
  assert.ok(r.diagnostics.some(x => x.code === 'RESEARCH_INCONCLUSIVE_CONCLUSION'))
})

test('Research title/publisher metadata without stable locator is not complete provenance', () => {
  let state = structuredClone(profiles.research.initialState)
  state = resolveProfileEvent(profiles.research, state, { id: 'c1', type: 'CLAIM_PROPOSED', payload: { claimId: 'c1', text: 'H' } }).resolvedState
  const r = resolveProfileEvent(profiles.research, state, { id: 'e1', type: 'EVIDENCE_RECORDED', payload: { evidenceId: 'e1', claimId: 'c1', stance: 'support', source: { title: 'Descriptive only', publisher: 'Publisher' }, independenceGroup: 'g1' } })
  assert.equal(getPath(r.resolvedState, 'research.claims.c1.provenanceComplete'), false)
  assert.ok(r.diagnostics.some(x => x.code === 'RESEARCH_INCOMPLETE_PROVENANCE'))
})

test('Research incomplete provenance blocks ready conclusion', () => {
  let state = structuredClone(profiles.research.initialState)
  state = resolveProfileEvent(profiles.research, state, { id: 'c1', type: 'CLAIM_PROPOSED', payload: { claimId: 'c1', text: 'H' } }).resolvedState
  for (const [id, group, withProv] of [['e1','g1',true], ['e2','g2',false]]) {
    state = resolveProfileEvent(profiles.research, state, { id, type: 'EVIDENCE_RECORDED', payload: { evidenceId: id, claimId: 'c1', stance: 'support', source: withProv ? { title: id, publisher: group, locator: id } : { id }, independenceGroup: group, quality: { relevance: 1, reliability: 1, independence: 1 } } }).resolvedState
  }
  state = resolveProfileEvent(profiles.research, state, { id: 'v1', type: 'VALIDATION_RESULT', payload: { validationId: 'v1', claimId: 'c1', outcome: 'support', confidence: 1, reproducible: true } }).resolvedState
  const r = resolveProfileEvent(profiles.research, state, { type: 'CONCLUSION_REQUESTED', payload: { claimId: 'c1' } })
  assert.equal(getPath(r.resolvedState, 'research.conclusionStatus'), 'blocked')
  assert.ok(getPath(r.resolvedState, 'research.claims.c1.decision.reasons').includes('incomplete-provenance'))
})


test('Tutor multi-skill real ASSISTments replay remains sane against advisory BKT reference', async () => {
  const csv = await readFile(resolve('applications/tutor/assistments-multiskill-real.csv'), 'utf8')
  const summary = summarizeAssistmentsCsv(csv)
  assert.ok(summary.rows >= 50)
  assert.ok(summary.users >= 7)
  assert.ok(summary.skills >= 4)
  assert.ok(summary.hintedRows >= 10)
  assert.ok(summary.multipleAttemptRows >= 15)
  assert.ok(summary.bottomHintRows >= 5)

  const selected = [
    ['70363','Number Line'], ['70363','Circle Graph'], ['71066','Circle Graph'], ['70363','Box and Whisker'],
    ['70729','Box and Whisker'], ['70363','Histogram as Table or Graph'], ['70699','Circle Graph'], ['70740','Circle Graph'],
    ['70699','Box and Whisker'], ['71179','Box and Whisker'], ['71205','Box and Whisker'],
  ]
  const comparisons = []
  for (const [userId, skillId] of selected) {
    const scenario = assistmentsCsvToScenario(csv, { id: `stable-${userId}-${canonicalSkillKey(skillId)}`, userId, skillId })
    const result = runProfileScenario(profiles.tutor, scenario)
    const model = getPath(result.finalState, `learner.skills.${canonicalSkillKey(skillId)}`)
    const bkt = runBktTrace(scenario.steps.map(x => x.event), { pInit: 1 / 3, pLearn: 0.1, pGuess: 0.2, pSlip: 0.1 })
    const outcomes = scenario.steps.map(x => x.event.payload.correct)
    comparisons.push({
      id: `${userId}/${skillId}`, pplStart: 1 / 3, pplFinal: model.mean, bktFinal: bkt.finalKnown,
      allCorrect: outcomes.every(Boolean), allIncorrect: outcomes.every(x => x === false),
    })
  }
  const check = compareTutorToBkt(comparisons, { severeGap: 0.60, minSpearman: -0.25 })
  assert.equal(check.passed, true)
  assert.ok(check.traces >= 10)
  assert.ok(check.spearman > 0.5)
})

test('Research strong validation requires re-locatable provenance', () => {
  let state = structuredClone(profiles.research.initialState)
  state = resolveProfileEvent(profiles.research, state, { id: 'c-prov', type: 'CLAIM_PROPOSED', payload: { claimId: 'c-prov', text: 'H' } }).resolvedState
  state = resolveProfileEvent(profiles.research, state, { id: 'e1', type: 'EVIDENCE_RECORDED', payload: { evidenceId: 'e1', claimId: 'c-prov', stance: 'support', source: { locator: 'doi:e1' }, independenceGroup: 'g1', quality: { relevance: 1, reliability: 1, independence: 1 } } }).resolvedState
  state = resolveProfileEvent(profiles.research, state, { id: 'e2', type: 'EVIDENCE_RECORDED', payload: { evidenceId: 'e2', claimId: 'c-prov', stance: 'support', source: { locator: 'doi:e2' }, independenceGroup: 'g2', quality: { relevance: 1, reliability: 1, independence: 1 } } }).resolvedState
  const validation = resolveProfileEvent(profiles.research, state, { id: 'v-no-prov', type: 'VALIDATION_RESULT', payload: { validationId: 'v-no-prov', claimId: 'c-prov', kind: 'replication', outcome: 'support', confidence: 1, reproducible: true } })
  assert.equal(getPath(validation.resolvedState, 'research.claims.c_prov.validation.strongSupport'), 0)
  assert.ok(validation.diagnostics.some(x => x.code === 'RESEARCH_STRONG_VALIDATION_PROVENANCE_REQUIRED'))
})

test('Research status and direction are symmetric: strong negative validation can produce ready+oppose', () => {
  let state = structuredClone(profiles.research.initialState)
  state = resolveProfileEvent(profiles.research, state, { id: 'c-neg', type: 'CLAIM_PROPOSED', payload: { claimId: 'c-neg', text: 'H' } }).resolvedState
  // Weak historical support is retained, then multiple independent opposing sources and strong replication dominate.
  state = resolveProfileEvent(profiles.research, state, { id: 's1', type: 'EVIDENCE_RECORDED', payload: { evidenceId: 's1', claimId: 'c-neg', stance: 'support', source: { locator: 'doi:s1' }, independenceGroup: 's1', quality: { relevance: 0.7, reliability: 0.7, independence: 1 } } }).resolvedState
  for (const [id, group] of [['o1','o1'], ['o2','o2']]) {
    state = resolveProfileEvent(profiles.research, state, { id, type: 'EVIDENCE_RECORDED', payload: { evidenceId: id, claimId: 'c-neg', stance: 'oppose', source: { locator: `doi:${id}` }, independenceGroup: group, quality: { relevance: 1, reliability: 1, independence: 1 } } }).resolvedState
  }
  state = resolveProfileEvent(profiles.research, state, { id: 'v-neg', type: 'VALIDATION_RESULT', payload: { validationId: 'v-neg', claimId: 'c-neg', kind: 'replication', outcome: 'oppose', confidence: 1, reproducible: true, independenceGroup: 'v-neg', provenance: { locator: 'doi:v-neg' } } }).resolvedState
  const r = resolveProfileEvent(profiles.research, state, { type: 'CONCLUSION_REQUESTED', payload: { claimId: 'c-neg' } })
  assert.equal(getPath(r.resolvedState, 'research.conclusionStatus'), 'ready')
  assert.equal(getPath(r.resolvedState, 'research.conclusionDirection'), 'oppose')
  assert.equal(getPath(r.resolvedState, 'research.claims.c_neg.decision.direction'), 'oppose')
})

test('Research real strong-validation scenario is blocked before validation then ready+support after independent second observation', async () => {
  const scenario = await load('profiles/research/scenarios/gravitational-wave-strong-validation.json')
  const result = runProfileScenario(profiles.research, scenario)
  assert.equal(getPath(result.entries[3].snapshot.resolution.resolvedState, 'research.conclusionStatus'), 'blocked')
  assert.equal(getPath(result.finalState, 'research.conclusionStatus'), 'ready')
  assert.equal(getPath(result.finalState, 'research.conclusionDirection'), 'support')
  assert.equal(getPath(result.finalState, 'research.claims.claim_gw_detection.validation.strongSupport'), 1)
})

test('Research real evidence-flip case moves qualified support to inconclusive mixed under conflicting strong replications', async () => {
  const scenario = await load('profiles/research/scenarios/ego-depletion-evidence-flip.json')
  const result = runProfileScenario(profiles.research, scenario)
  assert.equal(getPath(result.entries[5].snapshot.resolution.resolvedState, 'research.conclusionStatus'), 'qualified')
  assert.equal(getPath(result.entries[5].snapshot.resolution.resolvedState, 'research.conclusionDirection'), 'support')
  assert.equal(getPath(result.entries[8].snapshot.resolution.resolvedState, 'research.conclusionStatus'), 'inconclusive')
  assert.equal(getPath(result.finalState, 'research.conclusionStatus'), 'inconclusive')
  assert.equal(getPath(result.finalState, 'research.conclusionDirection'), 'mixed')
  assert.ok(getPath(result.finalState, 'research.claims.claim_ego_depletion.validation.strongSupport') >= 1)
  assert.ok(getPath(result.finalState, 'research.claims.claim_ego_depletion.validation.strongOppose') >= 2)
})

test('generic Character and Life profiles remain compatible', async () => {
  const char = runProfileScenario(profiles.character, await load('profiles/character/scenarios/relationship-cycle.json'))
  const life = runProfileScenario(profiles.life, await load('profiles/life/scenarios/service-cycle.json'))
  assert.equal(getPath(char.finalState, 'relationship.stage'), 'lover')
  assert.equal(getPath(life.finalState, 'service.escalationRequired'), true)
})

test('Profile scenario exports app-session/0.3 with engine/literature metadata', async () => {
  const result = runProfileScenario(profiles.research, await load('profiles/research/scenarios/application-cycle.json'))
  const app = toAppSession(profiles.research, result)
  assert.equal(app.schema, 'ppl.app-session/0.3')
  assert.equal(app.domain.profileKind, 'research')
  assert.equal(app.profile.engine.id, 'research/evidence-ledger')
  assert.ok(app.literature.length >= 3)
})

test('Profile resolution remains staged and finalize rollback is authoritative', () => {
  const base = structuredClone(profiles.tutor.initialState)
  const resolution = resolveProfileEvent(profiles.tutor, base, { id: 'obs', type: 'LEARNER_OBSERVATION', payload: { evidenceId: 'obs', skillId: 'fractions.addition', correct: true, assessment: { hintCount: 0, attemptCount: 1 } } })
  assert.equal(getPath(base, 'learner.evidenceIds').length, 0)
  assert.equal(getPath(resolution.resolvedState, 'learner.evidenceIds').length, 1)
  const aborted = finalizeProfileResolution(profiles.tutor, base, resolution, 'aborted')
  assert.equal(aborted.committed, false)
  assert.equal(getPath(aborted.state, 'learner.evidenceIds').length, 0)
})
