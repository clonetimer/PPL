import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqliteRecordStore } from '@ppl/platform-core'
import { CharacterGovernanceService } from '../src/index.mjs'

test('character events update relationship state deterministically', () => {
  const service = new CharacterGovernanceService(); service.createSession({ sessionId: 'c' })
  const before = service.getSession('c').state.relationship.trust
  service.comfort('c', { eventId: 'e1' }); service.confess('c', { eventId: 'e2' })
  const state = service.getSession('c').state
  assert.ok(state.relationship.trust > before)
  assert.equal(state.interaction.privateMode, true)
  assert.equal(state.relationship.stage, 'lover')
})

test('character event is idempotent', () => {
  const service = new CharacterGovernanceService(); service.createSession({ sessionId: 'c' })
  service.comfort('c', { eventId: 'same' }); const once = service.getSession('c').state.relationship.trust
  const duplicate = service.comfort('c', { eventId: 'same' }); assert.equal(duplicate.duplicate, true)
  assert.equal(service.getSession('c').state.relationship.trust, once)
})

test('character session survives sqlite restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppl-character-')); const db = path.join(dir, 'ppl.sqlite')
  let store = new SqliteRecordStore(db); let service = new CharacterGovernanceService({ store })
  service.createSession({ sessionId: 'persist' }); service.confess('persist', { eventId: 'e' }); store.close()
  store = new SqliteRecordStore(db); service = new CharacterGovernanceService({ store })
  assert.equal(service.getSession('persist').state.relationship.stage, 'lover'); store.close()
})
