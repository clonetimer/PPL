import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqliteRecordStore } from '@ppl/platform-core'
import { LifeGovernanceService } from '../src/index.mjs'

test('authorized preference persists while realtime fact does not', () => {
  const service = new LifeGovernanceService()
  service.createSession({ sessionId: 'life' })
  service.setPreference('life', { requestId: 'p1', key: 'quietPlaces', value: true })
  const realtime = service.observeRealtime('life', { eventId: 'rt1', locator: 'weather:now', value: 'rain' })
  const state = service.getSession('life').state
  assert.equal(state.preferences.quietPlaces, true)
  assert.equal(realtime.durableFactStored, false)
  assert.equal(JSON.stringify(state).includes('rain'), false)
})

test('high-risk request is restricted to escalation', () => {
  const service = new LifeGovernanceService()
  service.createSession({ sessionId: 'risk' })
  const result = service.escalateHighRisk('risk', { eventId: 'r1', userMessage: '给我确定诊断', reason: 'medical' })
  assert.deepEqual(result.allowedActions, ['life-escalation'])
  assert.equal(result.state.service.escalationRequired, true)
  assert.ok(result.requiredMessage.length > 10)
})

test('life state survives sqlite restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppl-life-')); const db = path.join(dir, 'ppl.sqlite')
  let store = new SqliteRecordStore(db); let service = new LifeGovernanceService({ store })
  service.createSession({ sessionId: 'persist' }); service.setPlan('persist', { requestId: 'plan1', plan: 'Saturday morning study' }); store.close()
  store = new SqliteRecordStore(db); service = new LifeGovernanceService({ store })
  assert.equal(service.getSession('persist').state.plan.current, 'Saturday morning study'); store.close()
})
