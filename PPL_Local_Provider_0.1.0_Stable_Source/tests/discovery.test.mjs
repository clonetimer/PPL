import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { discoverVisibleModels, modelsEndpointFromChatEndpoint, resolveVisibleModel } from '../src/discovery.mjs'

test('models endpoint derives from chat endpoint', () => {
  assert.equal(modelsEndpointFromChatEndpoint('http://127.0.0.1:1234/v1/chat/completions'), 'http://127.0.0.1:1234/v1/models')
})

test('Qwen3.5-0.8B hint resolves LM Studio model identifiers without assuming exact ID', () => {
  const ids = ['text-embedding-model', 'qwen/qwen3.5-0.8b-q4_k_m']
  const r = resolveVisibleModel(ids, { hint: 'Qwen3.5-0.8B' })
  assert.equal(r.status, 'selected')
  assert.equal(r.selectedModel, 'qwen/qwen3.5-0.8b-q4_k_m')
})

test('ambiguous fuzzy matches require explicit model instead of guessing', () => {
  const ids = ['qwen3.5-0.8b-q4_k_m', 'qwen3.5-0.8b-q8_0']
  const r = resolveVisibleModel(ids, { hint: 'Qwen3.5-0.8B' })
  assert.equal(r.status, 'model-ambiguous')
  assert.equal(r.selectedModel, null)
})

test('discovery supports optional LM Studio bearer token', async () => {
  let auth = null
  const server = http.createServer((req, res) => { auth = req.headers.authorization; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen3.5-0.8b' }] })) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const { port } = server.address()
  try {
    const out = await discoverVisibleModels({ endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, apiKey: 'secret' })
    assert.deepEqual(out.modelIds, ['qwen3.5-0.8b'])
    assert.equal(auth, 'Bearer secret')
  } finally { server.close(); await once(server, 'close') }
})
