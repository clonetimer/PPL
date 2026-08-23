import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createOpenAICompatibleChatTransport, createOpenAICompatibleChatContinuationRequest } from '../src/openai-compatible-chat.mjs'
import { invokeWithResilience, collectStreamWithResilience } from 'ppl-llm-host-adapter/transport'

async function withServer(handler, fn) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const { port } = server.address()
  try { return await fn(`http://127.0.0.1:${port}/v1/chat/completions`) } finally { server.close(); await once(server, 'close') }
}

const tutorReq = {
  schema: 'ppl.gpt-host-request/0.1', modelRole: 'tutor', requestId: 'r1', instructions: ['minimal hint'], authority: {}, responseContract: {},
}

const tutorJson = JSON.stringify({ schema: 'ppl.gpt-host-response/0.1', message: 'hint', action: { kind: 'tutor-nonintervention', policyMode: 'observe', rationale: 'enough learner work' }, citations: [] })

test('non-loopback endpoints require explicit opt-in', () => {
  assert.throws(() => createOpenAICompatibleChatTransport({ endpoint: 'https://example.com/v1/chat/completions', model: 'x' }), /Refusing non-loopback/)
  assert.doesNotThrow(() => createOpenAICompatibleChatTransport({ endpoint: 'https://example.com/v1/chat/completions', model: 'x', allowRemoteEndpoint: true, fetchImpl: async () => {} }))
})

test('Ollama-style preset emits OpenAI Chat JSON schema and parses response', async () => {
  let seen
  await withServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    seen = { headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    res.setHeader('content-type', 'application/json'); res.setHeader('x-request-id', 'local-req-1')
    res.end(JSON.stringify({ id: 'chatcmpl-1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: tutorJson } }], usage: { prompt_tokens: 5, completion_tokens: 8 } }))
  }, async endpoint => {
    const transport = createOpenAICompatibleChatTransport({ preset: 'ollama', endpoint, model: 'qwen3' })
    const out = await invokeWithResilience(transport, tutorReq, { maxAttempts: 1 })
    assert.equal(out.status, 'completed'); assert.equal(out.output, tutorJson); assert.equal(out.providerRequestId, 'local-req-1')
  })
  assert.equal(seen.body.model, 'qwen3')
  assert.equal(seen.body.response_format.type, 'json_schema')
  assert.equal(seen.body.response_format.json_schema.strict, true)
  assert.equal(seen.body.messages[0].role, 'system')
  assert.match(seen.body.messages[0].content, /Required JSON Schema/)
  assert.equal(seen.headers.authorization, undefined)
})

test('prompt-only mode remains host-validatable and omits response_format', async () => {
  let seen
  await withServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    seen = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: tutorJson } }] }))
  }, async endpoint => {
    const transport = createOpenAICompatibleChatTransport({ preset: 'llama.cpp', endpoint, model: 'local' })
    const out = await invokeWithResilience(transport, tutorReq, { maxAttempts: 1 })
    assert.equal(out.status, 'completed')
  })
  assert.equal('response_format' in seen, false)
  assert.match(seen.messages[0].content, /ppl\.gpt-host-response/)
})

test('tool definition, named tool choice and parallel-control map to Chat Completions', async () => {
  let seen
  await withServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    seen = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: 'tool-1', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }] } }] }))
  }, async endpoint => {
    const transport = createOpenAICompatibleChatTransport({ preset: 'vllm', endpoint, model: 'local' })
    const request = { ...tutorReq, transportTools: [{ name: 'lookup', description: 'lookup', strict: true, parameters: { type: 'object', additionalProperties: false, required: ['q'], properties: { q: { type: 'string' } } } }], transportToolChoice: { type: 'function', name: 'lookup' }, transportParallelToolCalls: false }
    const out = await invokeWithResilience(transport, request, { maxAttempts: 1 })
    assert.equal(out.toolCalls[0].name, 'lookup'); assert.deepEqual(out.toolCalls[0].arguments, { q: 'x' })
  })
  assert.equal(seen.tools[0].function.name, 'lookup')
  assert.equal(seen.tools[0].function.strict, true)
  assert.deepEqual(seen.tool_choice, { type: 'function', function: { name: 'lookup' } })
  assert.equal(seen.parallel_tool_calls, false)
})

test('tool continuation sends assistant tool_calls then Host-owned tool result exactly once', async () => {
  const seen = []
  await withServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    res.setHeader('content-type', 'application/json')
    if (seen.length === 1) res.end(JSON.stringify({ id: 'a', choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }] } }] }))
    else res.end(JSON.stringify({ id: 'b', choices: [{ message: { role: 'assistant', content: tutorJson } }] }))
  }, async endpoint => {
    const capabilities = { protocol: 'openai-chat-completions', structuredOutput: 'json-schema', streaming: true, toolCalling: true, toolChoiceControl: false, parallelToolCallsControl: false }
    const transport = createOpenAICompatibleChatTransport({ endpoint, model: 'local', capabilities })
    const request = { ...tutorReq, transportTools: [{ name: 'lookup', parameters: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } } }] }
    const first = await invokeWithResilience(transport, request, { maxAttempts: 1 })
    const toolResult = { schema: 'ppl.llm-tool-result/0.1', callId: 'call_1', name: 'lookup', arguments: { q: 'x' }, output: { value: 7 }, provenance: { kind: 'host-tool', hostOwned: true, digest: 'sha256:test' } }
    const continuation = createOpenAICompatibleChatContinuationRequest(request, first, [toolResult])
    const second = await invokeWithResilience(transport, continuation, { maxAttempts: 1 })
    assert.equal(second.status, 'completed')
  })
  assert.equal(seen.length, 2)
  const msgs = seen[1].messages
  assert.deepEqual(msgs.map(x => x.role), ['system','user','assistant','tool'])
  assert.equal(msgs[2].tool_calls[0].id, 'call_1')
  assert.equal(msgs[3].tool_call_id, 'call_1')
  assert.equal(seen[1].tools, undefined, 'tool_choice=none fallback withholds tools when server lacks control')
})

test('429 errors participate in Stable Host resilience', async () => {
  let count = 0
  await withServer(async (_req, res) => {
    count += 1
    res.setHeader('content-type', 'application/json')
    if (count === 1) { res.statusCode = 429; res.setHeader('retry-after', '0'); res.end(JSON.stringify({ error: { message: 'busy' } })); return }
    res.end(JSON.stringify({ choices: [{ message: { content: tutorJson } }] }))
  }, async endpoint => {
    const transport = createOpenAICompatibleChatTransport({ preset: 'ollama', endpoint, model: 'qwen3' })
    const out = await invokeWithResilience(transport, tutorReq, { maxAttempts: 2, baseBackoffMs: 0, sleep: async () => {} })
    assert.equal(out.status, 'completed'); assert.equal(out.attempts.length, 2)
  })
})

test('stream maps text and tool-call deltas without Profile commits', async () => {
  await withServer(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 's1' })
    const chunks = [
      { id: 'c1', choices: [{ index: 0, delta: { content: '{"schema":"ppl.gpt-host-response/0.1",' } }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] } }] },
      { id: 'c1', choices: [{ index: 0, delta: { content: '"message":"ok"}' }, finish_reason: 'stop' }], usage: { total_tokens: 9 } },
    ]
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    res.write('data: [DONE]\n\n'); res.end()
  }, async endpoint => {
    const transport = createOpenAICompatibleChatTransport({ preset: 'vllm', endpoint, model: 'local' })
    const req = { ...tutorReq, transportTools: [{ name: 'lookup', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }] }
    const out = await collectStreamWithResilience(transport, req, { maxAttempts: 1 })
    assert.equal(out.status, 'completed'); assert.match(out.output, /ppl.gpt-host-response/); assert.deepEqual(out.toolCalls[0].arguments, { q: 'x' }); assert.equal(out.streamAudit.partialsCommittedToProfile, false)
  })
})

test('provider accepts application-defined portable responseContract.jsonSchema instead of hardcoding Profile kinds', async () => {
  let seen
  const customSchema = { type: 'object', additionalProperties: false, required: ['schema','message'], properties: { schema: { type: 'string', enum: ['custom.response/0.1'] }, message: { type: 'string' } } }
  await withServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    seen = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: '{"schema":"custom.response/0.1","message":"ok"}' } }] }))
  }, async endpoint => {
    const transport = createOpenAICompatibleChatTransport({ preset: 'ollama', endpoint, model: 'qwen3' })
    const out = await invokeWithResilience(transport, { schema: 'custom.request/0.1', modelRole: 'life', responseContract: { jsonSchema: customSchema } }, { maxAttempts: 1 })
    assert.equal(out.status, 'completed')
  })
  assert.deepEqual(seen.response_format.json_schema.schema, customSchema)
})


test('LM Studio preset uses port 1234, structured output, tools, and conservative tool controls', () => {
  const transport = createOpenAICompatibleChatTransport({ preset: 'lmstudio', model: 'qwen/qwen3.5-0.8b' })
  assert.equal(transport.config.endpoint, 'http://127.0.0.1:1234/v1/chat/completions')
  assert.equal(transport.capabilities.structuredOutput, 'json-schema')
  assert.equal(transport.capabilities.toolCalling, true)
  assert.equal(transport.capabilities.toolChoiceControl, false)
  assert.equal(transport.capabilities.parallelToolCallsControl, false)
})

test('tool-call phase can omit structured response_format and continuation restores it', async () => {
  const seen = []
  await withServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    res.setHeader('content-type', 'application/json')
    if (seen.length === 1) res.end(JSON.stringify({ id: 'a', choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_magic', type: 'function', function: { name: 'get_magic_number', arguments: '{}' } }] } }] }))
    else res.end(JSON.stringify({ id: 'b', choices: [{ message: { role: 'assistant', content: '{"schema":"ppl.local-cert-response/0.1","message":"ok","value":7}' } }] }))
  }, async endpoint => {
    const transport = createOpenAICompatibleChatTransport({ preset: 'lmstudio', endpoint, model: 'local' })
    const req = { schema: 'ppl.local-cert-request/0.1', modelRole: 'local-cert', responseContract: { jsonSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] } }, transportStructuredOutput: false, transportTools: [{ name: 'get_magic_number', parameters: { type: 'object', properties: {}, required: [] } }] }
    const first = await invokeWithResilience(transport, req, { maxAttempts: 1 })
    const toolResult = { schema: 'ppl.llm-tool-result/0.1', callId: first.toolCalls[0].callId, name: 'get_magic_number', arguments: {}, output: { value: 7 }, provenance: { kind: 'host-tool', hostOwned: true, digest: 'sha256:test' } }
    const next = createOpenAICompatibleChatContinuationRequest(req, first, [toolResult])
    await invokeWithResilience(transport, next, { maxAttempts: 1 })
  })
  assert.equal(seen[0].response_format, undefined)
  assert.match(seen[0].messages[0].content, /issue the provider tool call/i)
  assert.equal(seen[1].response_format.type, 'json_schema')
  assert.equal(seen[1].tools, undefined)
})
