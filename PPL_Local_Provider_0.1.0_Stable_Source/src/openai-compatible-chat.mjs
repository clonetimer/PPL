import { randomUUID } from 'node:crypto'
import { TransportError, transportIdentity } from 'ppl-llm-host-adapter/transport'
import { toolResultToModelInput } from 'ppl-llm-host-adapter/tools'
import { assessRequestCapabilities, localProviderPreset, normalizeProviderCapabilities } from './capabilities.mjs'

export const OPENAI_COMPATIBLE_CHAT_PROVIDER_SCHEMA = 'ppl.llm-provider.openai-compatible-chat/0.1'

function responseSchemaForRequest(request = {}) {
  if (request?.responseContract?.jsonSchema && typeof request.responseContract.jsonSchema === 'object') return request.responseContract.jsonSchema
  if (request.schema === 'ppl.gpt-policy-judge-request/0.1') return {
    type: 'object', additionalProperties: false, required: ['schema','compliant','confidence','violations'],
    properties: {
      schema: { type: 'string', enum: ['ppl.gpt-policy-judge-response/0.1'] }, compliant: { type: 'boolean' }, confidence: { type: 'number' },
      violations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code','severity','evidenceQuote','rationale'], properties: { code: { type: 'string' }, severity: { type: 'string', enum: ['warning','error'] }, evidenceQuote: { type: 'string' }, rationale: { type: 'string' } } } },
    },
  }
  if (request.schema === 'ppl.gpt-observer-request/0.1' && request.observerRole === 'research-evidence-judge') return {
    type: 'object', additionalProperties: false, required: ['schema','stance','relevance','confidence','summary'],
    properties: { schema: { type: 'string', enum: ['ppl.gpt-observer-response/0.1'] }, stance: { type: 'string', enum: ['support','oppose','neutral'] }, relevance: { type: 'number' }, confidence: { type: 'number' }, summary: { type: 'string' } },
  }
  if (request.schema === 'ppl.gpt-observer-request/0.1' && request.observerRole === 'tutor-assessment-observer') return {
    type: 'object', additionalProperties: false, required: ['schema','verdict','score','confidence','rationale','misconception'],
    properties: {
      schema: { type: 'string', enum: ['ppl.gpt-observer-response/0.1'] }, verdict: { type: 'string', enum: ['correct','incorrect','partial','unscorable'] }, score: { type: 'number' }, confidence: { type: 'number' }, rationale: { type: 'string' },
      misconception: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['id','confidence','evidenceQuote'], properties: { id: { type: 'string' }, confidence: { type: 'number' }, evidenceQuote: { type: 'string' } } }] },
    },
  }
  if (request.modelRole === 'tutor') return {
    type: 'object', additionalProperties: false, required: ['schema','message','action','citations'],
    properties: {
      schema: { type: 'string', enum: ['ppl.gpt-host-response/0.1'] }, message: { type: 'string' },
      action: { type: 'object', additionalProperties: false, required: ['kind','policyMode','rationale'], properties: { kind: { type: 'string', enum: ['tutor-intervention','tutor-nonintervention'] }, policyMode: { type: 'string' }, rationale: { type: 'string' } } },
      citations: { type: 'array', items: { type: 'string' } },
    },
  }
  return {
    type: 'object', additionalProperties: false, required: ['schema','message','action','citations'],
    properties: {
      schema: { type: 'string', enum: ['ppl.gpt-host-response/0.1'] }, message: { type: 'string' },
      action: { type: 'object', additionalProperties: false, required: ['kind','conclusionStatus','conclusionDirection','rationale','claim','plan'], properties: {
        kind: { type: 'string', enum: ['claim-proposal','research-plan','report'] }, conclusionStatus: { anyOf: [{ type: 'string' }, { type: 'null' }] }, conclusionDirection: { anyOf: [{ type: 'string' }, { type: 'null' }] }, rationale: { type: 'string' },
        claim: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['id','text','kind'], properties: { id: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string' } } }] }, plan: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      } }, citations: { type: 'array', items: { type: 'string' } },
    },
  }
}

function schemaPrompt(request) { return JSON.stringify(responseSchemaForRequest(request)) }
function systemMessage(request) {
  const instructions = Array.isArray(request.instructions) ? request.instructions : []
  const toolCallPhase = request.transportStructuredOutput === false && Array.isArray(request.transportTools) && request.transportTools.length > 0
  const content = toolCallPhase
    ? ['Use the provided tool when the user request requires it.', 'Never invent or simulate Host-owned tool output.', 'When a tool is required, issue the provider tool call before producing the final answer.', ...instructions]
    : ['Return only one JSON object matching the required PPL response contract.', 'Do not claim authority outside request.authority.', `Required JSON Schema: ${schemaPrompt(request)}`, ...instructions]
  return { role: 'system', content: content.join('\n') }
}
function userMessage(request) { return { role: 'user', content: JSON.stringify(request) } }
function baseMessages(request) { return [systemMessage(request), userMessage(request)] }

function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => typeof part === 'string' ? part : (part?.text || '')).join('')
}

function parseArgs(value) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value || '{}') } catch { return value }
}

function toolCallsFromMessage(message = {}) {
  return (message.tool_calls || []).map((call, index) => ({
    callId: call.id || `tool:${index}`,
    name: call.function?.name || call.name,
    arguments: parseArgs(call.function?.arguments ?? call.arguments),
  }))
}

function mapToolChoice(choice) {
  if (choice === undefined) return undefined
  if (typeof choice === 'string') return choice
  if (choice?.type === 'function' && choice.name) return { type: 'function', function: { name: choice.name } }
  if (choice?.type === 'function' && choice.function?.name) return choice
  return choice
}

function mapTools(request, capabilities, audit) {
  let defs = request.transportTools
  if (!Array.isArray(defs) || defs.length === 0) return undefined
  if (request.transportToolChoice === 'none' && !capabilities.toolChoiceControl) {
    audit.degradations.push('tools-withheld-to-enforce-tool-choice-none')
    return undefined
  }
  return defs.map(tool => ({
    type: 'function', function: {
      name: tool.name, description: tool.description || '', parameters: tool.parameters || { type: 'object', properties: {}, required: [] },
      ...(capabilities.strictToolSchema && typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
    },
  }))
}

function bodyFor(request, config, stream = false) {
  const assessment = assessRequestCapabilities(request, config.capabilities)
  if (!assessment.ok) throw new Error(`Provider capability mismatch: ${assessment.blockers.join(', ')}`)
  const audit = { ...assessment, degradations: [...assessment.degradations] }
  const body = {
    model: config.model,
    messages: Array.isArray(request.transportChatMessages) ? request.transportChatMessages : baseMessages(request),
    stream,
  }
  const mode = request.transportStructuredOutput === false ? 'none' : assessment.capabilities.structuredOutput
  if (mode === 'json-schema') body.response_format = { type: 'json_schema', json_schema: { name: 'ppl_host_contract', strict: true, schema: responseSchemaForRequest(request) } }
  else if (mode === 'json-object') body.response_format = { type: 'json_object' }
  const tools = mapTools(request, assessment.capabilities, audit)
  if (tools) body.tools = tools
  if (request.transportToolChoice !== undefined && assessment.capabilities.toolChoiceControl) body.tool_choice = mapToolChoice(request.transportToolChoice)
  if (typeof request.transportParallelToolCalls === 'boolean' && assessment.capabilities.parallelToolCallsControl) body.parallel_tool_calls = request.transportParallelToolCalls
  if (Number.isFinite(config.maxOutputTokens)) body.max_tokens = config.maxOutputTokens
  if (Number.isFinite(config.temperature)) body.temperature = config.temperature
  if (config.reasoningEffort && assessment.capabilities.reasoningEffort) body.reasoning_effort = config.reasoningEffort
  return { body, audit }
}

function headersObject(headers) { const out = {}; if (headers) for (const [k,v] of headers.entries()) out[k.toLowerCase()] = v; return out }
async function throwForBadResponse(response, clientRequestId) {
  if (response.ok) return
  const headers = headersObject(response.headers)
  let message = `OpenAI-compatible provider HTTP ${response.status}`
  try { const data = await response.json(); if (data?.error?.message) message = data.error.message } catch {}
  throw new TransportError(message, { code: `provider-http-${response.status}`, status: response.status, retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500, headers, providerRequestId: headers['x-request-id'] || clientRequestId })
}

function assertEndpointSafety(endpoint, allowRemoteEndpoint) {
  const url = new URL(endpoint)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Provider endpoint must use http or https')
  const loopback = ['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname)
  if (!loopback && !allowRemoteEndpoint) throw new Error(`Refusing non-loopback local-provider endpoint ${url.origin}; set allowRemoteEndpoint=true explicitly`)
}

async function* parseSse(response, signal) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { value, done } = await reader.read(); if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx); buffer = buffer.slice(idx + 2)
        const dataText = block.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trim()).join('\n')
        if (!dataText) continue
        if (dataText === '[DONE]') { yield { done: true }; return }
        try { yield JSON.parse(dataText) } catch {}
      }
    }
  } finally { try { reader.releaseLock() } catch {} }
}

export function createOpenAICompatibleChatContinuationRequest(request, priorTransportResult, toolResults = [], options = {}) {
  const priorMessage = priorTransportResult?.raw?.choices?.[0]?.message
  if (!priorMessage) throw new Error('Chat continuation requires prior raw choices[0].message')
  if (!Array.isArray(toolResults) || toolResults.length === 0) throw new Error('Chat continuation requires at least one Host tool result')
  const toolMessages = toolResults.map(result => {
    const generic = toolResultToModelInput(result)
    return { role: 'tool', tool_call_id: generic.call_id, content: generic.output }
  })
  const continuationRequest = { ...request, transportStructuredOutput: options.structuredOutput ?? true }
  return {
    ...continuationRequest,
    transportChatMessages: [...baseMessages(continuationRequest), { role: 'assistant', content: priorMessage.content ?? '', ...(priorMessage.tool_calls ? { tool_calls: priorMessage.tool_calls } : {}) }, ...toolMessages],
    transportToolChoice: options.toolChoice ?? 'none',
    transportParallelToolCalls: options.parallelToolCalls ?? false,
    transportContinuation: { provider: 'openai-compatible-chat', mode: 'chat-tool-messages', priorProviderRequestId: priorTransportResult.providerRequestId || null },
  }
}

export function createOpenAICompatibleChatTransport(options = {}) {
  const preset = options.preset ? localProviderPreset(options.preset, options) : null
  const endpoint = options.endpoint || preset?.endpoint || 'http://127.0.0.1:8000/v1/chat/completions'
  assertEndpointSafety(endpoint, Boolean(options.allowRemoteEndpoint))
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('OpenAI-compatible transport requires fetch')
  const capabilities = normalizeProviderCapabilities(options.capabilities || preset?.capabilities || {})
  const provider = options.provider || preset?.provider || 'openai-compatible-local'
  const model = options.model || 'local-model'
  const config = { schema: OPENAI_COMPATIBLE_CHAT_PROVIDER_SCHEMA, endpoint, model, capabilities, maxOutputTokens: options.maxOutputTokens, temperature: options.temperature, reasoningEffort: options.reasoningEffort }
  const identity = transportIdentity({ provider, model, deployment: options.deployment || endpoint, independenceGroup: options.independenceGroup || `${provider}:${model}:${endpoint}` })
  const apiKey = options.apiKey

  function headers(clientRequestId) {
    const out = { 'content-type': 'application/json', 'x-client-request-id': clientRequestId }
    if (apiKey) out.authorization = `Bearer ${apiKey}`
    return out
  }

  return {
    kind: 'openai-compatible-chat', identity, config, capabilities,
    assess(request) { return assessRequestCapabilities(request, capabilities) },
    async invoke(request, context = {}) {
      const clientRequestId = context.callId || randomUUID(); const built = bodyFor(request, config, false)
      const response = await fetchImpl(endpoint, { method: 'POST', headers: headers(clientRequestId), body: JSON.stringify(built.body), signal: context.signal })
      await throwForBadResponse(response, clientRequestId)
      const data = await response.json(); const choice = data?.choices?.[0] || {}; const message = choice.message || {}
      return { status: data?.error ? 'failed' : 'completed', output: contentText(message.content), toolCalls: toolCallsFromMessage(message), usage: data.usage || null, providerRequestId: response.headers.get('x-request-id') || data.id || clientRequestId, raw: data, retryable: false, capabilityAudit: built.audit }
    },
    async stream(request, context = {}) {
      const clientRequestId = context.callId || randomUUID(); const built = bodyFor(request, config, true)
      const response = await fetchImpl(endpoint, { method: 'POST', headers: headers(clientRequestId), body: JSON.stringify(built.body), signal: context.signal })
      await throwForBadResponse(response, clientRequestId)
      async function* mapped() {
        const toolIds = new Map(); let usage = null
        for await (const data of parseSse(response, context.signal)) {
          if (data.done) { yield { type: 'response.completed', providerRequestId: response.headers.get('x-request-id') || clientRequestId, usage }; return }
          if (data.usage) usage = data.usage
          for (const choice of data.choices || []) {
            const delta = choice.delta || {}
            if (typeof delta.content === 'string' && delta.content) yield { type: 'text.delta', delta: delta.content }
            for (const tc of delta.tool_calls || []) {
              const index = Number(tc.index ?? 0); const callId = tc.id || toolIds.get(index) || `tool:${index}`; toolIds.set(index, callId)
              yield { type: 'tool_call.delta', callId, name: tc.function?.name, delta: tc.function?.arguments || '' }
            }
            if (choice.finish_reason) yield { type: 'response.completed', providerRequestId: response.headers.get('x-request-id') || data.id || clientRequestId, usage }
          }
        }
      }
      return mapped()
    },
  }
}
