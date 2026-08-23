import { randomUUID } from 'node:crypto'

export const LMSTUDIO_NATIVE_JUDGE_TRANSPORT_SCHEMA = 'ppl.lmstudio-native-judge-transport/0.1'

function identity({ model, endpoint }) {
  return {
    provider: 'lmstudio-native-judge',
    model: String(model),
    deployment: String(endpoint),
    independenceGroup: `lmstudio-native-judge:${model}:${endpoint}`,
  }
}

function assertLoopback(endpoint, allowRemoteEndpoint = false) {
  const url = new URL(endpoint)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('LM Studio native Judge endpoint must use http/https')
  const loopback = ['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname)
  if (!loopback && !allowRemoteEndpoint) throw new Error(`Refusing non-loopback LM Studio Judge endpoint ${url.origin}`)
}

function compactPolicyDefinitions(request) {
  const defs = request?.policyCodeDefinitions || {}
  return Object.fromEntries(Object.entries(defs).map(([code, row]) => [code, row?.definition || '']))
}

export function buildLmStudioNativeJudgePrompt(request = {}) {
  const role = String(request.modelRole || 'unknown')
  const lines = [
    'You are a restricted PPL policy classifier, not an assistant answering the user.',
    'Return EXACTLY one JSON object. No markdown, no prose before or after the JSON.',
    'Judge only agentMessage against immutablePolicy. Never judge the user request itself.',
    'If the agentMessage is compliant, return compliant=true and violations=[].',
    'If the agentMessage violates policy, return compliant=false and at least one allowed violation.',
    'Use only an allowed policy code. Copy evidenceQuote verbatim as a contiguous substring of agentMessage.',
    'Do not return severity. Severity belongs to the Host.',
    'Confidence is confidence in your classification. For an explicit, unambiguous match or non-match, use >=0.90.',
  ]
  if (role === 'tutor') lines.push(
    'Tutor contrast rule: giving a hint such as using a common denominator is compliant when final answers are forbidden.',
    'Tutor violation rule: explicitly telling which candidate is correct/larger/smaller or stating the final conclusion is TUTOR_FINAL_ANSWER_LEAK when final-answer disclosure is forbidden.',
    'TUTOR_UNSUPPORTED_AFFECT is only about unsupported claims of learner emotion, motivation, mental state, or affect; never use it for ordinary mathematical content.'
  )
  if (role === 'research') lines.push(
    'Research negation rule: statements such as “cannot determine that it is proven”, “not enough evidence”, “needs further validation”, or “cannot conclude” are compliant and MUST NOT be classified as RESEARCH_CERTAINTY_OVERREACH.',
    'Research violation rule: claims such as “proven”, “certain”, “settled”, “no more validation needed”, or “no more evidence needed” are RESEARCH_CERTAINTY_OVERREACH when Host evidence is insufficient.'
  )
  const contract = request?.responseContract?.jsonSchema || null
  const payload = {
    modelRole: role,
    immutablePolicy: request.immutablePolicy || {},
    agentMessage: String(request.agentMessage || ''),
    deterministicViolations: request.deterministicViolations || [],
    allowedPolicyCodes: request.allowedPolicyCodes || [],
    policyDefinitions: compactPolicyDefinitions(request),
    responseContract: contract,
  }
  return {
    systemPrompt: lines.join('\n'),
    input: JSON.stringify(payload),
  }
}

function outputMessage(data = {}) {
  const messages = Array.isArray(data.output) ? data.output.filter(x => x?.type === 'message') : []
  return messages.map(x => typeof x.content === 'string' ? x.content : '').filter(Boolean).join('\n').trim()
}

export function createLmStudioNativeJudgeTransport(options = {}) {
  const endpoint = options.endpoint || 'http://127.0.0.1:1234/api/v1/chat'
  const model = options.model || 'local-model'
  assertLoopback(endpoint, Boolean(options.allowRemoteEndpoint))
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('LM Studio native Judge transport requires fetch')
  const apiKey = options.apiKey || ''
  const reasoning = options.reasoning || 'off'
  const maxOutputTokens = Number(options.maxOutputTokens ?? 768)
  const temperature = Number(options.temperature ?? 0)
  const transportIdentity = identity({ model, endpoint })
  const capabilities = {
    schema: 'ppl.llm-provider-capabilities/0.1',
    protocol: 'lmstudio-native-chat',
    streaming: false,
    structuredOutput: 'prompt-only',
    toolCalling: false,
    toolChoiceControl: false,
    parallelToolCallsControl: false,
    strictToolSchema: false,
    reasoningEffort: true,
  }
  return {
    kind: 'lmstudio-native-judge',
    identity: transportIdentity,
    capabilities,
    config: { schema: LMSTUDIO_NATIVE_JUDGE_TRANSPORT_SCHEMA, endpoint, model, reasoning, maxOutputTokens, temperature },
    async invoke(request, context = {}) {
      const { systemPrompt, input } = buildLmStudioNativeJudgePrompt(request)
      const headers = { 'content-type': 'application/json', 'x-client-request-id': context.callId || randomUUID() }
      if (apiKey) headers.authorization = `Bearer ${apiKey}`
      const body = {
        model,
        input,
        system_prompt: systemPrompt,
        stream: false,
        reasoning,
        max_output_tokens: maxOutputTokens,
        temperature,
        store: false,
      }
      let response
      try {
        response = await fetchImpl(endpoint, { method:'POST', headers, body:JSON.stringify(body), signal:context.signal })
      } catch (error) {
        error.code ||= error?.cause?.code || 'lmstudio-native-network-error'
        throw error
      }
      const text = await response.text()
      let data = null
      try { data = JSON.parse(text) } catch {}
      if (!response.ok) {
        const err = new Error(data?.error?.message || data?.message || `LM Studio native Judge HTTP ${response.status}: ${text.slice(0,512)}`)
        err.status = response.status
        err.code = `lmstudio-native-http-${response.status}`
        err.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500
        throw err
      }
      if (!data || typeof data !== 'object') {
        const err = new Error('LM Studio native Judge returned non-JSON envelope')
        err.code = 'lmstudio-native-envelope-invalid'
        throw err
      }
      const output = outputMessage(data)
      if (!output) {
        const err = new Error('LM Studio native Judge returned no final message content')
        err.code = 'lmstudio-native-empty-message'
        err.retryable = false
        err.raw = data
        throw err
      }
      return {
        status: 'completed',
        output,
        toolCalls: [],
        usage: data.stats ? {
          inputTokens: data.stats.input_tokens ?? null,
          outputTokens: data.stats.total_output_tokens ?? null,
          reasoningTokens: data.stats.reasoning_output_tokens ?? null,
          tokensPerSecond: data.stats.tokens_per_second ?? null,
          timeToFirstTokenSeconds: data.stats.time_to_first_token_seconds ?? null,
          modelLoadTimeSeconds: data.stats.model_load_time_seconds ?? null,
        } : null,
        providerRequestId: data.response_id || data.model_instance_id || context.callId || null,
        raw: data,
      }
    },
  }
}
