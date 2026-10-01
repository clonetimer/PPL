import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createResearchGovernanceServer } from '../src/server.mjs'

test('HTTP product surface exposes health and session creation', async t => {
  const { server } = createResearchGovernanceServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`
  const health = await fetch(`${base}/health`).then(r => r.json())
  assert.equal(health.ok, true)
  const response = await fetch(`${base}/v1/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'api-test', question: 'What does the evidence show?' }),
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.sessionId, 'api-test')
})
