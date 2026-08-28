import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createOpenAIResponsesTransport, createOpenAIResponsesContinuationRequest } from '../src/providers/openai-responses.mjs'
import { invokeWithResilience, collectStreamWithResilience } from '../src/transport.mjs'

async function withServer(handler, fn) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  try { return await fn(`http://127.0.0.1:${port}/v1/responses`) } finally { server.close(); await once(server, 'close') }
}

const hostReq = {
  schema: 'ppl.gpt-host-request/0.1', modelRole: 'tutor', requestId: 'r1', instructions: ['minimal hint'],
  authority: {}, responseContract: {},
}

test('OpenAI Responses provider sends store=false, structured output, and client request id', async () => {
  let seen
  await withServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    seen = { headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-request-id', 'server-req-1')
    res.end(JSON.stringify({ id: 'resp_1', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"schema":"ppl.gpt-host-response/0.1","message":"hint","action":{"kind":"tutor-nonintervention"}}' }] }] }))
  }, async endpoint => {
    const transport = createOpenAIResponsesTransport({ endpoint, model: 'gpt-5.6', apiKey: 'test-key' })
    const out = await invokeWithResilience(transport, hostReq, { maxAttempts: 1 })
    assert.equal(out.status, 'completed')
    assert.equal(out.providerRequestId, 'server-req-1')
  })
  assert.equal(seen.body.store, false)
  assert.equal(seen.body.text.format.type, 'json_schema')
  assert.equal(seen.body.text.format.strict, true)
  assert.equal(seen.body.model, 'gpt-5.6')
  assert.ok(seen.headers['x-client-request-id'])
  assert.equal(seen.headers.authorization, 'Bearer test-key')
})

test('OpenAI provider 429 participates in resilience retry', async () => {
  let count = 0
  await withServer(async (_req, res) => {
    count += 1
    if (count === 1) {
      res.statusCode = 429
      res.setHeader('content-type', 'application/json')
      res.setHeader('retry-after', '0')
      res.end(JSON.stringify({ error: { message: 'rate limit' } }))
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"schema":"ppl.gpt-host-response/0.1","message":"ok","action":{"kind":"tutor-nonintervention"}}' }] }] }))
  }, async endpoint => {
    const transport = createOpenAIResponsesTransport({ endpoint, apiKey: 'test-key', model: 'gpt-5.6' })
    const out = await invokeWithResilience(transport, hostReq, { maxAttempts: 2, baseBackoffMs: 0, sleep: async () => {} })
    assert.equal(out.status, 'completed')
    assert.equal(out.attempts.length, 2)
  })
})

test('OpenAI streaming maps text and function call events without committing partials', async () => {
  await withServer(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'stream-req' })
    const events = [
      { type: 'response.output_text.delta', delta: '{"schema":"ppl.gpt-host-response/0.1",' },
      { type: 'response.output_text.delta', delta: '"message":"ok","action":{"kind":"tutor-nonintervention"}}' },
      { type: 'response.function_call_arguments.delta', call_id: 'call_1', item_id: 'item_1', name: 'lookup', delta: '{"q":"x"}' },
      { type: 'response.function_call_arguments.done', call_id: 'call_1', item_id: 'item_1', name: 'lookup', arguments: '{"q":"x"}' },
      { type: 'response.completed', response: { id: 'resp-stream', usage: { input_tokens: 1, output_tokens: 2 } } },
    ]
    for (const e of events) res.write(`data: ${JSON.stringify(e)}\r\n\r\n`)
    res.end()
  }, async endpoint => {
    const transport = createOpenAIResponsesTransport({ endpoint, apiKey: 'test-key', model: 'gpt-5.6' })
    const out = await collectStreamWithResilience(transport, hostReq, { maxAttempts: 1 })
    assert.equal(out.status, 'completed')
    assert.match(out.output, /ppl.gpt-host-response/)
    assert.equal(out.toolCalls[0].name, 'lookup')
    assert.equal(out.toolCalls[0].arguments.q, 'x')
    assert.equal(out.streamAudit.partialsCommittedToProfile, false)
  })
})

test('OpenAI provider builds a store=false manual function_call_output continuation', async () => {
  const seen = []
  await withServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    res.setHeader('content-type', 'application/json')
    if (seen.length === 1) {
      res.end(JSON.stringify({
        id: 'resp_tool_1', status: 'completed',
        output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' }],
      }))
      return
    }
    res.end(JSON.stringify({
      id: 'resp_tool_2', status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"schema":"ppl.gpt-host-response/0.1","message":"done","action":{"kind":"tutor-nonintervention","policyMode":"observe","rationale":"tool complete"},"citations":[]}' }] }],
    }))
  }, async endpoint => {
    const transport = createOpenAIResponsesTransport({ endpoint, apiKey: 'test-key', model: 'gpt-5.6' })
    const request = {
      ...hostReq,
      transportTools: [{
        name: 'lookup', description: 'lookup',
        parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false },
      }],
      transportToolChoice: { type: 'function', name: 'lookup' },
      transportParallelToolCalls: false,
    }
    const first = await invokeWithResilience(transport, request, { maxAttempts: 1 })
    assert.equal(first.toolCalls.length, 1)
    const toolResult = {
      schema: 'ppl.llm-tool-result/0.1', callId: 'call_1', name: 'lookup', arguments: { q: 'x' }, output: { value: 7 },
      provenance: { kind: 'host-tool', hostOwned: true, digest: 'sha256:test' },
    }
    const continuation = createOpenAIResponsesContinuationRequest(request, first, [toolResult])
    const second = await invokeWithResilience(transport, continuation, { maxAttempts: 1 })
    assert.equal(second.status, 'completed')
  })
  assert.equal(seen.length, 2)
  assert.equal(seen[1].store, false)
  assert.equal(seen[1].tool_choice, 'none')
  assert.equal(seen[1].parallel_tool_calls, false)
  assert.ok(Array.isArray(seen[1].input))
  assert.equal(seen[1].input[0].role, 'user')
  assert.equal(seen[1].input[1].type, 'function_call')
  assert.equal(seen[1].input[2].type, 'function_call_output')
  assert.equal(seen[1].input[2].call_id, 'call_1')
})

test('OpenAI provider only enables strict function calling for strict-compatible tool schemas', async () => {
  const bodies = []
  await withServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'completed', output: [] }))
  }, async endpoint => {
    const transport = createOpenAIResponsesTransport({ endpoint, apiKey: 'test-key', model: 'gpt-5.6' })
    await transport.invoke({ ...hostReq, transportTools: [{
      name: 'strict_tool', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false },
    }] })
    await transport.invoke({ ...hostReq, transportTools: [{
      name: 'optional_tool', parameters: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer' } }, required: ['q'], additionalProperties: false },
    }] })
  })
  assert.equal(bodies[0].tools[0].strict, true)
  assert.equal(bodies[1].tools[0].strict, false)
})

test('OpenAI provider recursively checks nested strict tool schemas and rejects invalid explicit strict=true', async () => {
  const bodies = []
  await withServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'completed', output: [] }))
  }, async endpoint => {
    const transport = createOpenAIResponsesTransport({ endpoint, apiKey: 'test-key', model: 'gpt-5.6' })
    const nestedOptional = {
      name: 'nested_optional',
      parameters: {
        type: 'object', additionalProperties: false, required: ['query'],
        properties: {
          query: {
            type: 'object', additionalProperties: false, required: ['text'],
            properties: { text: { type: 'string' }, limit: { type: 'integer' } },
          },
        },
      },
    }
    await transport.invoke({ ...hostReq, transportTools: [nestedOptional] })
    await assert.rejects(
      transport.invoke({ ...hostReq, transportTools: [{ ...nestedOptional, strict: true }] }),
      /strict tool schema is incompatible/,
    )
  })
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].tools[0].strict, false)
})

test('0.1.3 OpenAI Responses Preview honors Host-owned responseContract.jsonSchema', async () => {
  let seen
  const customSchema = {
    type: 'object', additionalProperties: false, required: ['code'],
    properties: { code: { type: 'string', enum: ['A', 'B'] } },
  }
  await withServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    seen = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"code":"A"}' }] }] }))
  }, async endpoint => {
    const transport = createOpenAIResponsesTransport({ endpoint, apiKey: 'test-key', model: 'gpt-5.6' })
    const out = await invokeWithResilience(transport, { ...hostReq, responseContract: { jsonSchema: customSchema } }, { maxAttempts: 1 })
    assert.equal(out.status, 'completed')
  })
  assert.deepEqual(seen.text.format.schema, customSchema)
})
