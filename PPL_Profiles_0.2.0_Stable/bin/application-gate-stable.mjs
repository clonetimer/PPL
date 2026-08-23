#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assistmentsCsvToScenario, parseCsv, summarizeAssistmentsCsv } from '../packages/profile-tutor/src/adapters/assistments.mjs'
import { compareTutorToBkt, runBktTrace } from '../packages/profile-tutor/src/bkt.mjs'
import { runProfileScenario } from '../packages/profile-runtime/src/index.mjs'
import { getPath, toAppSession } from '../packages/profile-core/src/index.mjs'

const ROOT = resolve('.')
const readJson = async path => JSON.parse(await readFile(resolve(ROOT, path), 'utf8'))
const round = (value, digits = 4) => Number(Number(value).toFixed(digits))
const skillKey = value => String(value || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'
const writeJson = async (path, value) => {
  const full = resolve(ROOT, path)
  await mkdir(new URL('.', `file://${full}`).pathname, { recursive: true }).catch(() => {})
  await writeFile(full, JSON.stringify(value, null, 2) + '\n')
}

const tutor = await readJson('profiles/tutor/profile.json')
const research = await readJson('profiles/research/profile.json')
const csvPath = 'applications/tutor/assistments-multiskill-real.csv'
const csv = await readFile(resolve(ROOT, csvPath), 'utf8')
const rows = parseCsv(csv)
const summary = summarizeAssistmentsCsv(csv)

// Group chronological real rows into user × skill traces. Keep >=2 observations so the
// sanity baseline is trajectory-aware rather than a collection of one-point comparisons.
const groups = new Map()
for (const row of rows) {
  const user = String(row.user_id || '')
  const skill = String(row.skill_name || row.skill_id || '')
  if (!user || !skill) continue
  const key = `${user}::${skill}`
  if (!groups.has(key)) groups.set(key, { userId: user, skillId: skill, rows: [] })
  groups.get(key).rows.push(row)
}
const traceGroups = [...groups.values()]
  .filter(group => group.rows.length >= 2)
  .sort((a, b) => b.rows.length - a.rows.length || a.userId.localeCompare(b.userId) || a.skillId.localeCompare(b.skillId))

const traceReports = []
const appSessionSelections = new Set([
  '70363::Number Line',
  '70363::Circle Graph',
  '71066::Circle Graph',
  '70699::Circle Graph',
  '70363::Box and Whisker',
])
const appSessions = []
for (const group of traceGroups) {
  const scenario = assistmentsCsvToScenario(csv, {
    id: `assistments-${group.userId}-${skillKey(group.skillId)}`,
    userId: group.userId,
    skillId: group.skillId,
  })
  const result = runProfileScenario(tutor, scenario)
  const model = getPath(result.finalState, `learner.skills.${skillKey(group.skillId)}`)
  if (!model) continue
  const observations = scenario.steps.map(step => ({
    id: step.event.id,
    correct: step.event.payload.correct,
  }))
  const bkt = runBktTrace(observations, { pInit: 1 / 3, pLearn: 0.10, pGuess: 0.20, pSlip: 0.10 })
  const rawCorrect = observations.map(x => Boolean(x.correct))
  const assistedEvidence = result.entries.flatMap(entry => (entry.snapshot.resolution.artifacts || []).filter(x => x.type === 'tutor-evidence' && x.assistanceUsed))
  const report = {
    id: `${group.userId}:${group.skillId}`,
    userId: group.userId,
    skillId: group.skillId,
    interactions: scenario.steps.length,
    correct: rawCorrect.filter(Boolean).length,
    incorrect: rawCorrect.filter(x => !x).length,
    assistedEvidence: assistedEvidence.length,
    pplStart: round((tutor.tutorModel?.betaPrior?.alpha || 2) / ((tutor.tutorModel?.betaPrior?.alpha || 2) + (tutor.tutorModel?.betaPrior?.beta || 4))),
    pplFinal: model.mean,
    pplUncertainty: model.uncertainty,
    evidenceWeight: model.evidenceWeight,
    bktFinal: bkt.finalKnown,
    allCorrect: rawCorrect.length > 0 && rawCorrect.every(Boolean),
    allIncorrect: rawCorrect.length > 0 && rawCorrect.every(x => !x),
    bkt,
  }
  traceReports.push(report)
  if (appSessionSelections.has(`${group.userId}::${group.skillId}`)) {
    const session = toAppSession(tutor, result)
    const filename = `applications/tutor/assistments-${group.userId}-${skillKey(group.skillId)}.app-session.json`
    await writeFile(resolve(ROOT, filename), JSON.stringify(session, null, 2) + '\n')
    appSessions.push({ userId: group.userId, skillId: group.skillId, filename, snapshots: session.entries.length })
  }
}

const bktComparison = compareTutorToBkt(traceReports, { severeGap: 0.60, minSpearman: 0.50 })
const widthChecks = {
  rowsAtLeast50: summary.rows >= 50,
  usersAtLeast7: summary.users >= 7,
  skillsAtLeast4: summary.skills >= 4,
  hintedRowsAtLeast10: summary.hintedRows >= 10,
  multiAttemptRowsAtLeast15: summary.multipleAttemptRows >= 15,
  bottomHintRowsAtLeast5: summary.bottomHintRows >= 5,
  tracesAtLeast10: traceReports.length >= 10,
  selectedLongSessionsAtLeast4: appSessions.filter(x => x.snapshots >= 3).length >= 4,
}
const tutorPassed = Object.values(widthChecks).every(Boolean)
  && bktComparison.passed
  && bktComparison.spearman !== null
  && bktComparison.spearman >= 0.50

async function runResearchScenario(path, claimPath) {
  const scenario = await readJson(path)
  const result = runProfileScenario(research, scenario)
  const claim = getPath(result.finalState, claimPath)
  return { scenario, result, claim }
}

const ligo = await runResearchScenario('profiles/research/scenarios/gravitational-wave-strong-validation.json', 'research.claims.claim_gw_detection')
const egoFlip = await runResearchScenario('profiles/research/scenarios/ego-depletion-evidence-flip.json', 'research.claims.claim_ego_depletion')
const egoRefute = await runResearchScenario('profiles/research/scenarios/ego-depletion-strong-refutation.json', 'research.claims.claim_ego_refutation')

const snapshotState = (result, turn) => result.entries.find(x => x.snapshot.host.turn === turn)?.snapshot?.resolution?.resolvedState || {}
const ligoBefore = snapshotState(ligo.result, 4)
const ligoAfter = snapshotState(ligo.result, 6)
const egoEarly = snapshotState(egoFlip.result, 6)
const egoMid = snapshotState(egoFlip.result, 9)
const egoLate = snapshotState(egoFlip.result, 12)

const researchChecks = {
  ligoBlockedBeforeStrongValidation: getPath(ligoBefore, 'research.conclusionStatus') === 'blocked' && getPath(ligoBefore, 'research.conclusionDirection') === 'support',
  ligoReadySupportAfterStrongValidation: getPath(ligoAfter, 'research.conclusionStatus') === 'ready' && getPath(ligoAfter, 'research.conclusionDirection') === 'support' && Number(ligo.claim?.validation?.strongSupport || 0) >= 1,
  egoStartsQualifiedSupport: getPath(egoEarly, 'research.conclusionStatus') === 'qualified' && getPath(egoEarly, 'research.conclusionDirection') === 'support',
  egoBecomesInconclusiveMixed: getPath(egoMid, 'research.conclusionStatus') === 'inconclusive' && getPath(egoMid, 'research.conclusionDirection') === 'mixed',
  egoRemainsInconclusiveUnderConflictingStrongReplication: getPath(egoLate, 'research.conclusionStatus') === 'inconclusive' && getPath(egoLate, 'research.conclusionDirection') === 'mixed' && Number(egoFlip.claim?.validation?.strongSupport || 0) >= 1 && Number(egoFlip.claim?.validation?.strongOppose || 0) >= 2,
  realStrongNegativeCanBeReadyOppose: egoRefute.result.finalState.research.conclusionStatus === 'ready' && egoRefute.result.finalState.research.conclusionDirection === 'oppose' && egoRefute.result.finalState.workflow.nextAction === 'report-refutation' && Number(egoRefute.claim?.validation?.strongOppose || 0) >= 2,
}
const researchPassed = Object.values(researchChecks).every(Boolean)

const researchSessions = [
  ['applications/research/gravitational-wave-strong-validation.app-session.json', ligo],
  ['applications/research/ego-depletion-evidence-flip.app-session.json', egoFlip],
  ['applications/research/ego-depletion-strong-refutation.app-session.json', egoRefute],
]
for (const [path, row] of researchSessions) await writeFile(resolve(ROOT, path), JSON.stringify(toAppSession(research, row.result), null, 2) + '\n')

const report = {
  schema: 'ppl.profiles/application-gate/0.3',
  release: '0.2.0',
  passed: tutorPassed && researchPassed,
  tutor: {
    passed: tutorPassed,
    dataset: {
      name: 'ASSISTments 2009-2010 Skill Builder corrected public mirror subset',
      sourceFile: csvPath,
      provenanceClass: 'public-corrected-mirror-subset',
      limitation: 'This gate is a broadened real-row replay and sanity check, not a full-dataset calibration or KT accuracy claim.',
      summary,
    },
    widthChecks,
    traces: traceReports.map(({ bkt, ...row }) => row),
    bktComparison,
    bktRole: 'advisory sanity baseline only; PPL Tutor does not claim to reproduce or outperform BKT.',
    observatorySessions: appSessions,
  },
  research: {
    passed: researchPassed,
    checks: researchChecks,
    ligo: {
      before: { status: getPath(ligoBefore, 'research.conclusionStatus'), direction: getPath(ligoBefore, 'research.conclusionDirection') },
      after: { status: getPath(ligoAfter, 'research.conclusionStatus'), direction: getPath(ligoAfter, 'research.conclusionDirection') },
      claim: ligo.claim,
    },
    egoEvidenceFlip: {
      early: { status: getPath(egoEarly, 'research.conclusionStatus'), direction: getPath(egoEarly, 'research.conclusionDirection') },
      mid: { status: getPath(egoMid, 'research.conclusionStatus'), direction: getPath(egoMid, 'research.conclusionDirection') },
      late: { status: getPath(egoLate, 'research.conclusionStatus'), direction: getPath(egoLate, 'research.conclusionDirection') },
      claim: egoFlip.claim,
    },
    egoStrongRefutation: {
      status: egoRefute.result.finalState.research.conclusionStatus,
      direction: egoRefute.result.finalState.research.conclusionDirection,
      nextAction: egoRefute.result.finalState.workflow.nextAction,
      claim: egoRefute.claim,
    },
    mechanismFinding: 'Conclusion maturity and conclusion direction must be separate: strong validation can mature either a supporting conclusion or a refutation, while unresolved conflicting strong replications remain inconclusive/mixed.',
  },
  architecture: {
    coreChanged: false,
    runtimeChanged: false,
    sharedCoreRuntimeDefectObserved: false,
    profileLayerChanges: ['Tutor BKT sanity reference + broadened real replay', 'Research conclusion direction separated from maturity status'],
  },
}
await mkdir(resolve(ROOT, 'validation'), { recursive: true })
await writeFile(resolve(ROOT, 'validation/PROFILES_0.2_STABLE_APPLICATION_GATE.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exit(report.passed ? 0 : 1)
