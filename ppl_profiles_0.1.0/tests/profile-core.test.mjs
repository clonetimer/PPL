import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  validateProfile, runProfileScenario, toAppSession, resolveProfileEvent, finalizeProfileResolution,
  fingerprintProfile, getPath, PROFILE_SNAPSHOT_SCHEMA,
} from '../packages/profile-core/src/index.mjs'

async function load(path) { return JSON.parse(await readFile(resolve(path), 'utf8')) }

const profiles = Object.fromEntries(await Promise.all(['character', 'tutor', 'research', 'life'].map(async kind => [kind, await load(`profiles/${kind}/profile.json`)])))

test('all four stable profiles validate', () => {
  for (const [kind, profile] of Object.entries(profiles)) assert.deepEqual(validateProfile(profile), [], kind)
})

test('profile fingerprint is deterministic', () => {
  assert.equal(fingerprintProfile(profiles.tutor), fingerprintProfile(JSON.parse(JSON.stringify(profiles.tutor))))
})

test('Tutor learning cycle evolves mastery/difficulty and abort rolls back durable state', async () => {
  const scenario = await load('profiles/tutor/scenarios/learning-cycle.json')
  const result = runProfileScenario(profiles.tutor, scenario)
  assert.equal(getPath(result.finalState, 'learner.mastery'), 0.5)
  assert.equal(getPath(result.finalState, 'task.difficulty'), 2)
  assert.equal(getPath(result.finalState, 'pedagogy.hintLevel'), 1)
  assert.equal(getPath(result.entries[2].snapshot.resolution.resolvedState, 'learner.mastery'), 0.75)
  assert.equal(result.entries[2].snapshot.transaction.status, 'discarded')
  assert.equal(result.entries[2].snapshot.schema, PROFILE_SNAPSHOT_SCHEMA)
})

test('Tutor resolution is staged before finalize', () => {
  const profile = profiles.tutor
  const base = structuredClone(profile.initialState)
  const resolution = resolveProfileEvent(profile, base, { type: 'ASSESSMENT_PASSED', payload: { score: 0.9 } })
  assert.equal(getPath(base, 'learner.mastery'), 0.25)
  assert.equal(getPath(resolution.resolvedState, 'learner.mastery'), 0.5)
  const aborted = finalizeProfileResolution(profile, base, resolution, 'aborted')
  assert.equal(aborted.committed, false)
  assert.equal(getPath(aborted.state, 'learner.mastery'), 0.25)
})

test('Research cycle preserves conflict and produces qualified conclusion with provenance', async () => {
  const scenario = await load('profiles/research/scenarios/evidence-cycle.json')
  const result = runProfileScenario(profiles.research, scenario)
  assert.equal(getPath(result.finalState, 'research.evidenceCount'), 2)
  assert.equal(getPath(result.finalState, 'research.contradictionCount'), 1)
  assert.equal(getPath(result.finalState, 'research.conclusionStatus'), 'qualified')
  assert.equal(getPath(result.finalState, 'research.provenanceComplete'), true)
  assert.ok(getPath(result.finalState, 'research.uncertainty') >= 0.4)
})

test('Life cycle persists preference/plan, does not persist realtime fact, and escalates high risk', async () => {
  const scenario = await load('profiles/life/scenarios/service-cycle.json')
  const result = runProfileScenario(profiles.life, scenario)
  assert.equal(getPath(result.finalState, 'preferences.quietPlaces'), true)
  assert.equal(getPath(result.finalState, 'plan.status'), 'active')
  assert.equal(getPath(result.finalState, 'service.lastRealtimeFactStored'), false)
  assert.equal(getPath(result.finalState, 'service.escalationRequired'), true)
  assert.equal(getPath(result.finalState, 'service.boundary'), 'authoritative-source-required')
  assert.ok(result.entries[2].snapshot.resolution.diagnostics.some(x => x.code === 'REALTIME_FACT_HOST_OWNED'))
})

test('Character profile remains a compatibility application layer', async () => {
  const scenario = await load('profiles/character/scenarios/relationship-cycle.json')
  const result = runProfileScenario(profiles.character, scenario)
  assert.equal(getPath(result.finalState, 'relationship.stage'), 'lover')
  assert.equal(getPath(result.finalState, 'relationship.trust'), 0.87)
  assert.equal(getPath(result.finalState, 'interaction.privateMode'), true)
  assert.equal(profiles.character.personaBinding.runtimeOwner, 'PPL Runtime')
})

test('Profile scenario exports directly to host-neutral Observatory session', async () => {
  const scenario = await load('profiles/tutor/scenarios/learning-cycle.json')
  const result = runProfileScenario(profiles.tutor, scenario)
  const app = toAppSession(profiles.tutor, result)
  assert.equal(app.schema, 'ppl.app-session/0.2')
  assert.equal(app.profile.kind, 'tutor')
  assert.equal(app.entries.length, 3)
  assert.equal(app.entries[0].kind, 'profile')
  assert.equal(app.observability.metrics[0].path, 'learner.mastery')
})

test('Tutor evaluation can express cleared optional misconception', async () => {
  const scenario = await load('profiles/tutor/scenarios/learning-cycle.json')
  const result = runProfileScenario(profiles.tutor, scenario)
  const metric = result.evaluation.metrics.find(x => x.id === 'misconception_cleared')
  assert.equal(metric.type, 'exists')
  assert.equal(metric.value, false)
  assert.equal(metric.target, false)
})

test('same-priority rules preserve source order while higher priority runs first', () => {
  const profile = structuredClone(profiles.tutor)
  profile.id = 'test.priority-order'
  profile.rules = [
    { id: 'LOW_SOURCE_1', priority: 100, when: { source: 'event', path: 'type', op: 'eq', value: 'ORDER' }, effects: [{ op: 'set', path: 'pedagogy.mode', value: 'hint-first' }] },
    { id: 'HIGH', priority: 200, when: { source: 'event', path: 'type', op: 'eq', value: 'ORDER' }, effects: [{ op: 'set', path: 'pedagogy.mode', value: 'socratic' }] },
    { id: 'LOW_SOURCE_2', priority: 100, when: { source: 'event', path: 'type', op: 'eq', value: 'ORDER' }, effects: [{ op: 'set', path: 'pedagogy.mode', value: 'drill' }] },
  ]
  const r = resolveProfileEvent(profile, structuredClone(profile.initialState), { type: 'ORDER' })
  assert.deepEqual(r.activeRules.map(x => x.id), ['HIGH', 'LOW_SOURCE_1', 'LOW_SOURCE_2'])
  assert.equal(getPath(r.resolvedState, 'pedagogy.mode'), 'drill')
})
