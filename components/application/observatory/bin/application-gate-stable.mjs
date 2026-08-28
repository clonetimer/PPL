#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  validateSession, makeEvidenceBundle, verifyEvidenceBundle,
  tutorLearnerTrajectory, researchClaimTrajectory, domainAnalytics,
} from '../packages/app-core/src/index.mjs'

const load = async name => JSON.parse(await readFile(resolve(`packages/app-standalone/sample/${name}`), 'utf8'))
const sessions = {
  tutorNumberLine: await load('tutor-assistments-70363-number-line.app-session.json'),
  tutorCircle: await load('tutor-assistments-70363-circle-graph.app-session.json'),
  tutorMixedCircle: await load('tutor-assistments-71066-circle-graph.app-session.json'),
  tutorAllIncorrect: await load('tutor-assistments-70699-circle-graph.app-session.json'),
  researchLigo: await load('research-ligo-strong-validation.app-session.json'),
  researchEgoFlip: await load('research-ego-evidence-flip.app-session.json'),
  researchEgoRefute: await load('research-ego-strong-refutation.app-session.json'),
}

const results = {}
let passed = true
for (const [id, session] of Object.entries(sessions)) {
  const errors = validateSession(session)
  const bundle = makeEvidenceBundle(session, { metadata: { gate: 'application-stable', id } })
  const verification = verifyEvidenceBundle(bundle)
  const analytics = domainAnalytics(session)
  let domainChecks = {}
  if (id.startsWith('tutor')) {
    const t = tutorLearnerTrajectory(session)
    domainChecks = {
      trajectoryPointsMatchSnapshots: t.points.length === session.entries.length,
      hasSkillSummary: t.skills.length >= 1,
      hasEvidenceDirection: t.points.some(x => ['mastery-support', 'nonmastery-support'].includes(x.evidence?.direction)),
      uncertaintyVisible: t.points.some(x => Number.isFinite(Number(x.uncertainty))),
    }
    if (id === 'tutorNumberLine') domainChecks.longTrace = t.points.length >= 10 && t.summary.assistedPoints >= 5
    if (id === 'tutorAllIncorrect') domainChecks.nonmasteryDirectionVisible = t.points.every(x => x.evidence?.direction === 'nonmastery-support')
  } else {
    const r = researchClaimTrajectory(session)
    domainChecks = {
      trajectoryAvailable: r.points.length >= 3,
      directionVisible: r.points.some(x => ['support', 'oppose', 'mixed'].includes(x.conclusionDirection)),
      statusVisible: r.points.some(x => ['blocked', 'qualified', 'inconclusive', 'ready'].includes(x.conclusionStatus)),
    }
    if (id === 'researchLigo') domainChecks.readySupport = r.final?.conclusionStatus === 'ready' && r.final?.conclusionDirection === 'support'
    if (id === 'researchEgoFlip') domainChecks.evidenceFlipVisible = r.transitions.some(x => x.to === 'qualified/support') && r.transitions.some(x => x.to === 'inconclusive/mixed') && r.final?.conclusionDirection === 'mixed'
    if (id === 'researchEgoRefute') domainChecks.readyOppose = r.final?.conclusionStatus === 'ready' && r.final?.conclusionDirection === 'oppose' && r.final?.nextAction === 'report-refutation'
  }
  const ok = errors.length === 0 && verification.passed && Object.values(domainChecks).every(Boolean)
  passed &&= ok
  results[id] = {
    passed: ok,
    schema: session.schema,
    snapshots: session.entries.length,
    errors,
    bundleVerification: verification,
    analyticsKind: analytics.kind,
    domainChecks,
  }
}

const report = {
  schema: 'ppl.app/application-gate/0.5',
  release: '0.4.0',
  passed,
  inputContract: 'ppl.app-session/0.3',
  results,
  hostNeutral: true,
  resolverRerun: false,
  findings: {
    tutor: 'Long learner trajectories expose mastery, uncertainty, evidence direction and assistance history without rerunning Tutor resolution.',
    research: 'Claim trajectories render conclusion maturity and direction independently, including qualified/support → inconclusive/mixed and ready/oppose refutation.',
  },
}
await mkdir(resolve('validation'), { recursive: true })
await writeFile(resolve('validation/APP_0.4_STABLE_APPLICATION_GATE.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exit(passed ? 0 : 1)
