import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  compileLifeHostRequest,
  validateLifeHostResponse,
  buildLifeHostOwnedMutationFallback,
  applyLifeModelResponse,
} from '../src/index.mjs'

const profile = JSON.parse(fs.readFileSync(new URL('../profiles/life.profile.json', import.meta.url)))
const initial = () => structuredClone(profile.initialState)

function planResponse(plan) {
  return {
    schema: 'ppl.gpt-host-response/0.1',
    message: `计划：${plan}`,
    action: { kind: 'life-plan-proposal', rationale: 'explicit authorization', preference: null, plan: { plan }, escalation: null },
    citations: [],
  }
}

test('RC4 pins the explicitly authorized plan payload in JSON Schema and validator', () => {
  const requiredPlan = '周末先安排一次短途散步再整理阅读清单'
  const req = compileLifeHostRequest(profile, initial(), {
    userMessage: `明确授权把这个作为当前计划：${requiredPlan}。`,
    mutationAuthorization: { plan: true }, requiredActionKind: 'life-plan-proposal', requiredPlan,
  })
  const branch = req.responseContract.jsonSchema.properties.action.anyOf[0]
  assert.deepEqual(branch.properties.plan.properties.plan.enum, [requiredPlan])
  assert.equal(req.responseContract.requiredPlan, requiredPlan)
  assert.equal(validateLifeHostResponse(req, planResponse(requiredPlan)).valid, true)
})

test('RC4 rejects S1.10Q2 Turn 10 old-plan substitution before durable mutation', () => {
  const req = compileLifeHostRequest(profile, initial(), {
    userMessage: '明确授权把这个作为当前计划：周末先安排一次短途散步再整理阅读清单。',
    mutationAuthorization: { plan: true }, requiredActionKind: 'life-plan-proposal',
    requiredPlan: '周末先安排一次短途散步再整理阅读清单',
  })
  const check = validateLifeHostResponse(req, planResponse('明天早上先整理三件最重要的事'))
  assert.equal(check.valid, false)
  assert.ok(check.errors.some(x => x.includes('requiredPlan')))
})

test('RC4 Host-owned plan fallback commits exactly the authorized payload', () => {
  const requiredPlan = '周末先安排一次短途散步再整理阅读清单'
  const state = initial()
  state.plan = { current: '明天早上先整理三件最重要的事', status: 'active' }
  const req = compileLifeHostRequest(profile, state, {
    requestId: 'life:rc4:plan', userMessage: `明确授权把这个作为当前计划：${requiredPlan}。`,
    mutationAuthorization: { plan: true }, requiredActionKind: 'life-plan-proposal', requiredPlan,
  })
  const fallback = buildLifeHostOwnedMutationFallback(req)
  assert.equal(fallback.action.plan.plan, requiredPlan)
  assert.equal(validateLifeHostResponse(req, fallback).valid, true)
  const applied = applyLifeModelResponse(profile, state, req, fallback)
  assert.equal(applied.state.plan.current, requiredPlan)
  assert.equal(applied.finalized.committed, true)
})

test('RC4 can pin an explicitly authorized preference payload', () => {
  const req = compileLifeHostRequest(profile, initial(), {
    userMessage: '现在明确授权：以后取消“优先安静地点”这个长期偏好。',
    mutationAuthorization: { preference: true }, requiredActionKind: 'life-preference-proposal',
    requiredPreference: { key: 'quietPlaces', value: false },
  })
  const fallback = buildLifeHostOwnedMutationFallback(req)
  assert.deepEqual(fallback.action.preference, { key: 'quietPlaces', value: false })
  assert.equal(validateLifeHostResponse(req, fallback).valid, true)
})

test('RC4 required mutation payload cannot create authorization', () => {
  assert.throws(() => compileLifeHostRequest(profile, initial(), {
    userMessage: '把它设成计划', requiredActionKind: 'life-plan-proposal', requiredPlan: 'unauthorized plan',
  }), /not authorized|requiredPlan requires/)
})
