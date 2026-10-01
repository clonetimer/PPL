import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqliteRecordStore } from '@ppl/platform-core'
import { TutorGovernanceService } from '../src/index.mjs'

test('unaided success carries more mastery evidence than hinted success', () => {
  const direct = new TutorGovernanceService()
  const hinted = new TutorGovernanceService()
  direct.createSession({ sessionId: 'd', skillId: 'fractions.addition' })
  hinted.createSession({ sessionId: 'h', skillId: 'fractions.addition' })
  direct.observe('d', { evidenceId: 'e1', skillId: 'fractions.addition', correct: true, assessment: { hintCount: 0, attemptCount: 1 } })
  hinted.observe('h', { evidenceId: 'e2', skillId: 'fractions.addition', correct: true, assessment: { hintCount: 2, attemptCount: 2 } })
  assert.ok(direct.getSummary('d').model.mean > hinted.getSummary('h').model.mean)
})

test('duplicate observation is exactly-once at product boundary', () => {
  const service = new TutorGovernanceService()
  service.createSession({ sessionId: 's', skillId: 'fractions.addition' })
  const first = service.observe('s', { eventId: 'event-1', evidenceId: 'obs-1', correct: false })
  const second = service.observe('s', { eventId: 'event-1', evidenceId: 'obs-1', correct: false })
  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
  assert.equal(service.getSummary('s').model.observations, 1)
})

test('tutor session survives sqlite restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppl-tutor-'))
  const db = path.join(dir, 'ppl.sqlite')
  let store = new SqliteRecordStore(db)
  let service = new TutorGovernanceService({ store })
  service.createSession({ sessionId: 'persist', skillId: 'fractions.addition' })
  service.observe('persist', { evidenceId: 'persist-evidence', correct: true })
  store.close()
  store = new SqliteRecordStore(db)
  service = new TutorGovernanceService({ store })
  assert.equal(service.getSummary('persist').model.observations, 1)
  store.close()
})
