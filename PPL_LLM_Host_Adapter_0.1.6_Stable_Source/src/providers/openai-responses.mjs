import { randomUUID } from 'node:crypto'
import { TransportError, transportIdentity } from '../transport.mjs'
import { toolResultToModelInput } from '../tools.mjs'

export const OPENAI_RESPONSES_PROVIDER_SCHEMA = 'ppl.llm-provider.openai-responses/0.1'

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/responses'

function responseSchemaForRequest(request = {}) {
  if (request?.responseContract?.jsonSchema && typeof request.responseContract.jsonSchema === 'object') return request.responseContract.jsonSchema
  if (request.schema === 'ppl.gpt-policy-judge-request/0.1') {
    return {
      type: 'object', additionalProperties: false,
      required: ['schema', 'compliant', 'confidence', 'violations'],
      properties: {
        schema: { type: 'string', enum: ['ppl.gpt-policy-judge-response/0.2'] },
        compliant: { type: 'boolean' },
        confidence: { type: 'number' },
        violations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code','evidenceQuote','rationale'], properties: { code: { type: 'string' }, evidenceQuote: { type: 'string' }, rationale: { type: 'string' } } } },
      },
    }
  }
  if (request.schema === 'ppl.gpt-observer-request/0.1' && request.observerRole === 'research-evidence-judge') {
    return {
      type: 'object', additionalProperties: false,
      required: ['schema','stance','relevance','confidence','summary'],
      properties: {
        schema: { type: 'string', enum: ['ppl.gpt-observer-response/0.1'] },
        stance: { type: 'string', enum: ['support','oppose','neutral'] }, relevance: { type: 'number' }, confidence: { type: 'number' }, summary: { type: 'string' },
      },
    }
  }
  if (request.schema === 'ppl.gpt-observer-request/0.1' && request.observerRole === 'tutor-assessment-observer') {
    return {
      type: 'object', additionalProperties: false,
      required: ['schema','verdict','score','confidence','rationale','misconception'],
      properties: {
        schema: { type: 'string', enum: ['ppl.gpt-observer-response/0.1'] }, verdict: { type: 'string', enum: ['correct','incorrect','partial','unscorable'] }, score: { type: 'number' }, confidence: { type: 'number' }, rationale: { type: 'string' },
        misconception: { anyOf: [
          { type: 'null' },
          { type: 'object', additionalProperties: false, required: ['id','confidence','evidenceQuote'], properties: { id: { type: 'string' }, confidence: { type: 'number' }, evidenceQuote: { type: 'string' } } },
        ] },
      },
    }
  }
  if (request.modelRole === 'tutor') {
    return {
      type: 'object', additionalProperties: false,
      required: ['schema','message','action','citations'],
      properties: {
        schema: { type: 'string', enum: ['ppl.gpt-host-response/0.1'] },
        message: { type: 'string' },
        action: { type: 'object', additionalProperties: false, required: ['kind','policyMode','rationale'], properties: {
          kind: { type: 'string', enum: ['tutor-intervention','tutor-nonintervention'] }, policyMode: { type: 'string' }, rationale: { type: 'string' },
        } },
        citations: { type: 'array', items: { type: 'string' } },
      },
    }
  }
  return {
    type: 'object', additionalProperties: false,
    required: ['schema','message','action','citations'],
    properties: {
      schema: { type: 'string', enum: ['ppl.gpt-host-response/0.1'] },
      message: { type: 'string' },
      action: { type: 'object', additionalProperties: false, required: ['kind','conclusionStatus','conclusionDirection','rationale','claim','plan'], properties: {
        kind: { type: 'string', enum: ['claim-proposal','research-plan','report'] },
        conclusionStatus: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        conclusionDirection: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        rationale: { type: 'string' },
        claim: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['id','text','kind'], properties: { id: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string' } } }] },
        plan: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      } },
      citations: { type: 'array', items: { type: 'string' } },
    },
  }
}

function providerInstructions(request = {}) {
  const lines = Array.isArray(request.instructions) ? request.instructions : []
  return [
    'Return only the JSON object required by the supplied schema.',
    'Do not claim authority outside the request.authority contract.',
    ...lines,
  ].join('\n')
}

function providerInput(request = {}) {
  return JSON.stringify(request)
}

function providerInputItem(request = {}) {
  return { role: 'user', content: providerInput(request) }
}

function requestInput(request = {}) {
  if (Array.isArray(request.transportInputItems)) return request.transportInputItems
  return providerInput(request)
}

function outputTextFromResponse(data) {
  if (typeof data?.output_text === 'string') return data.output_text
  const texts = []
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue
    for (const content of item.content || []) if (content?.type === 'output_text' && typeof content.text === 'string') texts.push(content.text)
  }
  return texts.join('')
}

function toolCallsFromResponse(data) {
  const calls = []
  for (const item of data?.output || []) {
    if (item?.type !== 'function_call') continue
    let args = item.arguments
    try { args = JSON.parse(item.arguments || '{}') } catch {}
    calls.push({ callId: item.call_id || item.id, name: item.name, arguments: args })
  }
  return calls
}

function headersObject(headers) {
  const out = {}
  if (!headers) return out
  for (const [k, v] of headers.entries()) out[k.toLowerCase()] = v
  return out
}

function isStrictFunctionSchemaCompatible(schema) {
  if (!schema || typeof schema !== 'object') return true

  const nestedSchemas = []
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key])) nestedSchemas.push(...schema[key])
  }
  if (schema.items && typeof schema.items === 'object') nestedSchemas.push(schema.items)
  for (const defsKey of ['$defs', 'definitions']) {
    if (schema[defsKey] && typeof schema[defsKey] === 'object') nestedSchemas.push(...Object.values(schema[defsKey]))
  }

  const objectLike = schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object')) || schema.properties !== undefined
  if (objectLike) {
    const properties = schema.properties || {}
    const required = new Set(schema.required || [])
    if (schema.additionalProperties !== false) return false
    if (!Object.keys(properties).every(name => required.has(name))) return false
    nestedSchemas.push(...Object.values(properties))
  }

  return nestedSchemas.every(isStrictFunctionSchemaCompatible)
}

function toolDefinitions(request) {
  const defs = request?.transportTools
  if (!Array.isArray(defs) || defs.length === 0) return undefined
  return defs.map(tool => {
    const parameters = tool.parameters || { type: 'object', properties: {}, required: [], additionalProperties: false }
    const strictCompatible = isStrictFunctionSchemaCompatible(parameters)
    if (tool.strict === true && !strictCompatible) {
      throw new Error(`OpenAI strict tool schema is incompatible for ${tool.name || '<unnamed>'}: every object must set additionalProperties=false and require all declared properties`)
    }
    return {
      type: 'function',
      name: tool.name,
      description: tool.description || '',
      parameters,
      // OpenAI strict function schemas require every object property (including
      // nested objects) to be required; optional values should be nullable.
      // PPL still validates the Host-side tool schema if this provider falls back
      // to non-strict function calling.
      strict: tool.strict === false ? false : strictCompatible,
    }
  })
}

function bodyFor(request, options, stream = false) {
  const body = {
    model: options.model,
    store: false,
    instructions: providerInstructions(request),
    input: requestInput(request),
    stream,
    text: {
      format: {
        type: 'json_schema',
        name: 'ppl_host_contract',
        schema: responseSchemaForRequest(request),
        strict: true,
      },
    },
  }
  const tools = toolDefinitions(request)
  if (tools) body.tools = tools
  if (request.transportToolChoice !== undefined) body.tool_choice = request.transportToolChoice
  if (typeof request.transportParallelToolCalls === 'boolean') body.parallel_tool_calls = request.transportParallelToolCalls
  if (Number.isFinite(options.maxOutputTokens)) body.max_output_tokens = options.maxOutputTokens
  if (options.reasoningEffort) body.reasoning = { effort: options.reasoningEffort }
  return body
}

export function createOpenAIResponsesContinuationRequest(request, priorTransportResult, toolResults = [], options = {}) {
  const outputItems = priorTransportResult?.raw?.output
  if (!Array.isArray(outputItems)) throw new Error('OpenAI continuation requires prior transport raw.output items')
  if (!Array.isArray(toolResults) || toolResults.length === 0) throw new Error('OpenAI continuation requires at least one Host tool result')
  return {
    ...request,
    transportInputItems: [
      providerInputItem(request),
      ...outputItems,
      ...toolResults.map(toolResultToModelInput),
    ],
    transportToolChoice: options.toolChoice ?? 'none',
    transportParallelToolCalls: options.parallelToolCalls ?? false,
    transportContinuation: {
      provider: 'openai-responses',
      mode: 'manual-output-items',
      priorProviderRequestId: priorTransportResult.providerRequestId || null,
    },
  }
}

async function throwForBadResponse(response, clientRequestId) {
  if (response.ok) return
  const headers = headersObject(response.headers)
  let message = `OpenAI Responses API HTTP ${response.status}`
  try {
    const data = await response.json()
    if (data?.error?.message) message = data.error.message
  } catch {}
  throw new TransportError(message, {
    code: `openai-http-${response.status}`,
    status: response.status,
    retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
    headers,
    providerRequestId: headers['x-request-id'] || clientRequestId,
  })
}

async function* parseSse(response, signal) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLines = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())
        if (!dataLines.length) continue
        const dataText = dataLines.join('\n')
        if (dataText === '[DONE]') return
        let event
        try { event = JSON.parse(dataText) } catch { continue }
        yield event
      }
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }
}

export function createOpenAIResponsesTransport(options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('OpenAI transport requires fetch')
  const config = {
    schema: OPENAI_RESPONSES_PROVIDER_SCHEMA,
    endpoint: options.endpoint || DEFAULT_ENDPOINT,
    model: options.model || 'gpt-5.6',
    maxOutputTokens: options.maxOutputTokens,
    reasoningEffort: options.reasoningEffort,
  }
  const identity = transportIdentity({ provider: 'openai', model: config.model, deployment: options.deployment, independenceGroup: options.independenceGroup || `openai:${config.model}` })

  function authHeaders(clientRequestId) {
    if (!apiKey && !options.allowMissingApiKey) throw new Error('OPENAI_API_KEY is required for live OpenAI transport')
    const headers = { 'content-type': 'application/json', 'x-client-request-id': clientRequestId }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    if (options.project) headers['openai-project'] = options.project
    if (options.organization) headers['openai-organization'] = options.organization
    return headers
  }

  return {
    kind: 'openai-responses',
    identity,
    config,
    async invoke(request, context = {}) {
      const clientRequestId = context.callId || randomUUID()
      const response = await fetchImpl(config.endpoint, {
        method: 'POST', headers: authHeaders(clientRequestId), body: JSON.stringify(bodyFor(request, config, false)), signal: context.signal,
      })
      await throwForBadResponse(response, clientRequestId)
      const data = await response.json()
      const text = outputTextFromResponse(data)
      return {
        status: data.status === 'completed' || !data.status ? 'completed' : data.status,
        output: text,
        toolCalls: toolCallsFromResponse(data),
        usage: data.usage || null,
        providerRequestId: response.headers.get('x-request-id') || data.id || clientRequestId,
        raw: data,
        retryable: data.status === 'failed' || data.status === 'incomplete',
      }
    },
    async stream(request, context = {}) {
      const clientRequestId = context.callId || randomUUID()
      const response = await fetchImpl(config.endpoint, {
        method: 'POST', headers: authHeaders(clientRequestId), body: JSON.stringify(bodyFor(request, config, true)), signal: context.signal,
      })
      await throwForBadResponse(response, clientRequestId)
      async function* mapped() {
        for await (const event of parseSse(response, context.signal)) {
          if (event.type === 'response.output_text.delta') yield { type: 'text.delta', delta: event.delta }
          else if (event.type === 'response.function_call_arguments.delta') yield { type: 'tool_call.delta', callId: event.call_id || event.item_id, name: event.name, delta: event.delta }
          else if (event.type === 'response.function_call_arguments.done') yield { type: 'tool_call.done', callId: event.call_id || event.item_id, name: event.name, arguments: event.arguments }
          else if (event.type === 'response.completed') yield { type: 'response.completed', providerRequestId: response.headers.get('x-request-id') || event.response?.id || clientRequestId, usage: event.response?.usage || null }
          else if (event.type === 'response.failed') yield { type: 'response.failed', code: event.response?.error?.code || 'openai-response-failed', message: event.response?.error?.message || 'OpenAI response failed', retryable: true }
          else if (event.type === 'response.incomplete') yield { type: 'response.failed', code: 'openai-response-incomplete', message: event.response?.incomplete_details?.reason || 'OpenAI response incomplete', retryable: true }
        }
      }
      return mapped()
    },
  }
}
