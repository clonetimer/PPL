import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MemoryRecordStore, SqliteRecordStore, IdempotencyConflictError } from '../src/index.mjs'

for (const [name, factory] of [
  ['memory', () => new MemoryRecordStore()],
  ['sqlite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppl-store-'))
    return new SqliteRecordStore(path.join(dir, 'store.sqlite'))
  }],
]) {
  test(`${name}: record revisions and exactly-once events`, () => {
    const store = factory()
    const first = store.create('sessions:test', 's1', { count: 1 })
    assert.equal(first.revision, 1)
    const second = store.save('sessions:test', 's1', { count: 2 }, { expectedRevision: 1 })
    assert.equal(second.revision, 2)
    const e1 = store.appendEvent('audit:test', 's1', { eventId: 'e1', type: 'created', payload: { x: 1 }, at: '2026-01-01T00:00:00.000Z' })
    const e2 = store.appendEvent('audit:test', 's1', { eventId: 'e1', type: 'created', payload: { x: 1 }, at: '2026-01-01T00:00:00.000Z' })
    assert.equal(e1.duplicate, false)
    assert.equal(e2.duplicate, true)
    assert.equal(store.listEvents('audit:test', 's1').length, 1)
    store.close()
  })
}

test('sqlite idempotency key rejects payload drift', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppl-idem-'))
  const store = new SqliteRecordStore(path.join(dir, 'store.sqlite'))
  assert.equal(store.claimIdempotency('turn', 'k1', { a: 1 }).accepted, true)
  assert.equal(store.claimIdempotency('turn', 'k1', { a: 1 }).duplicate, true)
  assert.throws(() => store.claimIdempotency('turn', 'k1', { a: 2 }), IdempotencyConflictError)
  store.close()
})
