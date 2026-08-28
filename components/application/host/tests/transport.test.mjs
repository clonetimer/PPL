import test from 'node:test'
import assert from 'node:assert/strict'
import { createCallbackTransport, invokeWithResilience, collectStreamWithResilience, TransportError, assertModelIndependence, SessionWriteCoordinator } from '../src/transport.mjs'
import { createToolRegistry, executeToolCall, validateToolArguments } from '../src/tools.mjs'

test('transport retries retryable 429 and succeeds without exceeding budget', async () => {
  let calls = 0
  const transport = createCallbackTransport({ identity: { provider: 'fake', model: 'agent' }, invoke: async () => {
    calls += 1
    if (calls === 1) throw new TransportError('rate limited', { status: 429, code: 'http-429', retryable: true, headers: { 'retry-after': '0' } })
    return { status: 'completed', output: { ok: true } }
  } })
  const out = await invokeWithResilience(transport, { x: 1 }, { maxAttempts: 3, baseBackoffMs: 0, sleep: async () => {} })
  assert.equal(out.status, 'completed')
  assert.equal(out.attempts.length, 2)
  assert.equal(out.output.ok, true)
})

test('transport timeout exhausts budget and never returns completed', async () => {
  const transport = createCallbackTransport({ identity: { provider: 'fake', model: 'slow' }, invoke: async (_r, ctx) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 100)
      ctx.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
    return { status: 'completed', output: 'late' }
  } })
  const out = await invokeWithResilience(transport, {}, { timeoutMs: 5, maxAttempts: 1 })
  assert.equal(out.status, 'failed')
  assert.equal(out.attempts[0].error.code, 'timeout')
})

test('outer abort cancels retry loop', async () => {
  const controller = new AbortController()
  const transport = createCallbackTransport({ identity: { provider: 'fake', model: 'abort' }, invoke: async (_r, ctx) => {
    controller.abort()
    ctx.signal.throwIfAborted()
  } })
  const out = await invokeWithResilience(transport, {}, { signal: controller.signal, maxAttempts: 3 })
  assert.equal(out.status, 'cancelled')
  assert.equal(out.attempts.length, 1)
})

test('stream collects deltas but marks partials as never committed', async () => {
  const transport = createCallbackTransport({ identity: { provider: 'fake', model: 'stream' }, stream: async function* () {
    yield { type: 'text.delta', delta: '{"a":' }
    yield { type: 'text.delta', delta: '1}' }
    yield { type: 'tool_call.delta', callId: 'c1', name: 'lookup', delta: '{"q":"x"}' }
    yield { type: 'response.completed', providerRequestId: 'req-1' }
  } })
  const out = await collectStreamWithResilience(transport, {}, { maxAttempts: 1 })
  assert.equal(out.status, 'completed')
  assert.equal(out.output, '{"a":1}')
  assert.equal(out.toolCalls[0].name, 'lookup')
  assert.equal(out.streamAudit.partialsCommittedToProfile, false)
})

test('model independence can be required or preferred', () => {
  const agent = createCallbackTransport({ identity: { provider: 'openai', model: 'gpt', independenceGroup: 'same' }, invoke: async () => ({ output: '{}' }) })
  const judge = createCallbackTransport({ identity: { provider: 'openai', model: 'gpt', independenceGroup: 'same' }, invoke: async () => ({ output: '{}' }) })
  assert.throws(() => assertModelIndependence(agent, judge, 'required'), /independence required/)
  const preferred = assertModelIndependence(agent, judge, 'preferred')
  assert.equal(preferred.independent, false)
  assert.equal(preferred.warnings.length, 1)
})

test('session write coordinator serializes same-session writers', async () => {
  const coordinator = new SessionWriteCoordinator()
  const order = []
  const a = coordinator.runExclusive('s', async () => { order.push('a:start'); await new Promise(r => setTimeout(r, 15)); order.push('a:end') })
  const b = coordinator.runExclusive('s', async () => { order.push('b:start'); order.push('b:end') })
  await Promise.all([a, b])
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end'])
  assert.equal(coordinator.pendingSessions(), 0)
})

test('tool registry enforces allowlist/schema and produces host-owned provenance', async () => {
  const registry = createToolRegistry([{
    name: 'sum', description: 'sum two integers', parameters: { type: 'object', required: ['a','b'], additionalProperties: false, properties: { a: { type: 'integer' }, b: { type: 'integer' } } },
    execute: async ({ a, b }) => ({ value: a + b }), provenance: 'test-tool',
  }])
  assert.equal(validateToolArguments(registry.get('sum').parameters, { a: 1, b: 2 }).valid, true)
  await assert.rejects(() => executeToolCall(registry, { name: 'sum', arguments: { a: 1, b: 'x' } }), /validation failed/)
  await assert.rejects(() => executeToolCall(registry, { name: 'delete_everything', arguments: {} }), /not allowlisted/)
  const out = await executeToolCall(registry, { callId: 'call-1', name: 'sum', arguments: { a: 1, b: 2 } })
  assert.equal(out.output.value, 3)
  assert.equal(out.provenance.hostOwned, true)
  assert.match(out.provenance.digest, /^[0-9a-f]{64}$/)
})

test('tool execution ledger is idempotent by callId and rejects changed arguments', async () => {
  const { ToolExecutionLedger } = await import('../src/tools.mjs')
  let executions = 0
  const registry = createToolRegistry([{ name: 'side_effect', parameters: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'integer' } } }, execute: async ({ value }) => { executions += 1; return { accepted: value } } }])
  const ledger = new ToolExecutionLedger()
  const a = await ledger.execute(registry, { callId: 'same-call', name: 'side_effect', arguments: { value: 1 } })
  const b = await ledger.execute(registry, { callId: 'same-call', name: 'side_effect', arguments: { value: 1 } })
  assert.equal(executions, 1)
  assert.equal(a.replayed, false)
  assert.equal(b.replayed, true)
  await assert.rejects(() => ledger.execute(registry, { callId: 'same-call', name: 'side_effect', arguments: { value: 2 } }), /reused with different/)
})

test('tool execution idempotency survives Host restart with durable JSON store', async () => {
  const { ToolExecutionLedger, JsonFileToolExecutionStore } = await import('../src/tools.mjs')
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ppl-tool-ledger-'))
  const file = path.join(dir, 'ledger.json')
  let executions = 0
  const registry = createToolRegistry([{ name: 'charge_like_side_effect', parameters: { type: 'object', required: ['amount'], additionalProperties: false, properties: { amount: { type: 'integer' } } }, execute: async ({ amount }) => { executions += 1; return { receipt: `r${executions}`, amount } } }])
  const firstProcess = new ToolExecutionLedger({ store: new JsonFileToolExecutionStore(file) })
  const a = await firstProcess.execute(registry, { callId: 'durable-call', name: 'charge_like_side_effect', arguments: { amount: 7 } })
  const secondProcess = new ToolExecutionLedger({ store: new JsonFileToolExecutionStore(file) })
  const b = await secondProcess.execute(registry, { callId: 'durable-call', name: 'charge_like_side_effect', arguments: { amount: 7 } })
  assert.equal(executions, 1)
  assert.equal(a.replayed, false)
  assert.equal(b.replayed, true)
  await assert.rejects(() => secondProcess.execute(registry, { callId: 'durable-call', name: 'charge_like_side_effect', arguments: { amount: 8 } }), /reused with different/)
})
