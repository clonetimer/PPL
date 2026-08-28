import { randomUUID } from 'node:crypto'

export const LLM_TRANSPORT_RESULT_SCHEMA = 'ppl.llm-transport-result/0.1'
export const LLM_TRANSPORT_ATTEMPT_SCHEMA = 'ppl.llm-transport-attempt/0.1'

export class TransportError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'TransportError'
    this.code = options.code || 'transport-error'
    this.status = Number.isFinite(options.status) ? options.status : undefined
    this.retryable = Boolean(options.retryable)
    this.headers = options.headers || {}
    this.providerRequestId = options.providerRequestId || null
  }
}

export function transportIdentity(input = {}) {
  const provider = String(input.provider || 'unknown')
  const model = String(input.model || 'unknown')
  return {
    provider,
    model,
    deployment: input.deployment ? String(input.deployment) : null,
    independenceGroup: String(input.independenceGroup || `${provider}:${model}`),
  }
}

export function createCallbackTransport(options = {}) {
  if (typeof options.invoke !== 'function' && typeof options.stream !== 'function') {
    throw new Error('Callback transport requires invoke and/or stream')
  }
  return {
    kind: 'callback',
    identity: transportIdentity(options.identity || {}),
    invoke: options.invoke,
    stream: options.stream,
  }
}

function retryableHttpStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

export function classifyTransportFailure(error) {
  if (error instanceof TransportError) return error
  if (error?.name === 'AbortError') return new TransportError(error.message || 'aborted', { code: 'aborted', retryable: false, cause: error })
  const status = Number(error?.status)
  if (Number.isFinite(status)) {
    return new TransportError(error.message || `HTTP ${status}`, { code: `http-${status}`, status, retryable: retryableHttpStatus(status), headers: error.headers, cause: error })
  }
  const code = String(error?.code || '')
  const retryableNetworkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'])
  return new TransportError(error?.message || 'network failure', {
    code: code || 'network-error',
    retryable: retryableNetworkCodes.has(code) || error instanceof TypeError,
    cause: error,
  })
}

function createTimeoutSignal(timeoutMs, outerSignal) {
  const controller = new AbortController()
  let timedOut = false
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true
    controller.abort(new Error('transport timeout'))
  }, timeoutMs) : null
  const onAbort = () => controller.abort(outerSignal?.reason || new Error('aborted'))
  if (outerSignal) {
    if (outerSignal.aborted) onAbort()
    else outerSignal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      if (timer) clearTimeout(timer)
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort)
    },
  }
}

function parseRetryAfterMs(headers = {}) {
  const value = headers['retry-after'] ?? headers['Retry-After']
  if (value === undefined || value === null) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return Math.max(0, numeric * 1000)
  const at = Date.parse(String(value))
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
}

function defaultBackoffMs(attempt, baseMs = 200) {
  return Math.min(5000, Math.max(0, baseMs) * (2 ** Math.max(0, attempt - 1)))
}

function normalizeCompletedResult(result, meta = {}) {
  if (!result || typeof result !== 'object') {
    return { schema: LLM_TRANSPORT_RESULT_SCHEMA, status: 'completed', output: result, ...meta }
  }
  return {
    schema: LLM_TRANSPORT_RESULT_SCHEMA,
    status: result.status || 'completed',
    output: result.output,
    toolCalls: Array.isArray(result.toolCalls) ? result.toolCalls : [],
    usage: result.usage || null,
    providerRequestId: result.providerRequestId || null,
    raw: result.raw,
    ...meta,
  }
}

export async function invokeWithResilience(transport, request, options = {}) {
  if (!transport || typeof transport.invoke !== 'function') throw new Error('Transport does not implement invoke()')
  const maxAttempts = Math.max(1, Number(options.maxAttempts ?? 3))
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 30000))
  const baseBackoffMs = Math.max(0, Number(options.baseBackoffMs ?? 200))
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const attempts = []
  const callId = options.callId || `call:${randomUUID()}`

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      return { schema: LLM_TRANSPORT_RESULT_SCHEMA, status: 'cancelled', callId, attempts, error: { code: 'aborted', message: 'outer signal aborted before invocation' } }
    }
    const timeout = createTimeoutSignal(timeoutMs, options.signal)
    const startedAt = new Date().toISOString()
    const startedMs = Date.now()
    try {
      const result = await transport.invoke(request, { signal: timeout.signal, attempt, callId })
      if (timeout.timedOut()) throw new TransportError(`transport timed out after ${timeoutMs}ms`, { code: 'timeout', retryable: true })
      const normalized = normalizeCompletedResult(result, { callId })
      const attemptRow = {
        schema: LLM_TRANSPORT_ATTEMPT_SCHEMA,
        attempt,
        startedAt,
        durationMs: Date.now() - startedMs,
        status: normalized.status,
        providerRequestId: normalized.providerRequestId,
      }
      attempts.push(attemptRow)
      if (normalized.status === 'completed') return { ...normalized, attempts }
      if (normalized.status === 'cancelled') return { ...normalized, attempts }
      const retryable = Boolean(result.retryable)
      if (!retryable || attempt === maxAttempts) return { ...normalized, attempts }
      const waitMs = Number(result.retryAfterMs ?? defaultBackoffMs(attempt, baseBackoffMs))
      await sleep(waitMs)
    } catch (error) {
      let failure = classifyTransportFailure(error)
      if (timeout.timedOut()) failure = new TransportError(`transport timed out after ${timeoutMs}ms`, { code: 'timeout', retryable: true, cause: error })
      const attemptRow = {
        schema: LLM_TRANSPORT_ATTEMPT_SCHEMA,
        attempt,
        startedAt,
        durationMs: Date.now() - startedMs,
        status: 'failed',
        error: { code: failure.code, message: failure.message, status: failure.status || null, retryable: failure.retryable },
        providerRequestId: failure.providerRequestId,
      }
      attempts.push(attemptRow)
      if (options.signal?.aborted) {
        timeout.cleanup()
        return { schema: LLM_TRANSPORT_RESULT_SCHEMA, status: 'cancelled', callId, attempts, error: attemptRow.error }
      }
      if (!failure.retryable || attempt === maxAttempts) {
        timeout.cleanup()
        return { schema: LLM_TRANSPORT_RESULT_SCHEMA, status: 'failed', callId, attempts, error: attemptRow.error }
      }
      const retryAfterMs = parseRetryAfterMs(failure.headers)
      const waitMs = retryAfterMs ?? defaultBackoffMs(attempt, baseBackoffMs)
      timeout.cleanup()
      await sleep(waitMs)
      continue
    } finally {
      timeout.cleanup()
    }
  }
  return { schema: LLM_TRANSPORT_RESULT_SCHEMA, status: 'failed', callId, attempts, error: { code: 'exhausted', message: 'retry budget exhausted' } }
}

export async function collectStreamWithResilience(transport, request, options = {}) {
  if (!transport || typeof transport.stream !== 'function') throw new Error('Transport does not implement stream()')
  const maxAttempts = Math.max(1, Number(options.maxAttempts ?? 2))
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 30000))
  const baseBackoffMs = Math.max(0, Number(options.baseBackoffMs ?? 200))
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const callId = options.callId || `stream:${randomUUID()}`
  const attempts = []

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timeout = createTimeoutSignal(timeoutMs, options.signal)
    const startedAt = new Date().toISOString()
    const startedMs = Date.now()
    let text = ''
    const toolCalls = new Map()
    const publicEvents = []
    let completedMeta = null
    try {
      const iterable = await transport.stream(request, { signal: timeout.signal, attempt, callId })
      for await (const event of iterable) {
        if (!event || typeof event !== 'object') continue
        if (event.type === 'text.delta') text += String(event.delta || '')
        else if (event.type === 'tool_call.delta') {
          const row = toolCalls.get(event.callId) || { callId: event.callId, name: event.name || null, argumentsText: '' }
          if (event.name) row.name = event.name
          row.argumentsText += String(event.delta || '')
          toolCalls.set(event.callId, row)
        } else if (event.type === 'tool_call.done') {
          const row = toolCalls.get(event.callId) || { callId: event.callId, name: event.name || null, argumentsText: '' }
          row.name = event.name || row.name
          row.argumentsText = event.arguments ?? row.argumentsText
          toolCalls.set(event.callId, row)
        } else if (event.type === 'response.completed') completedMeta = event
        else if (event.type === 'response.failed') throw new TransportError(event.message || 'stream response failed', { code: event.code || 'stream-failed', retryable: Boolean(event.retryable), status: event.status })
        if (options.onEvent) options.onEvent(event)
        publicEvents.push({ type: event.type, sequence: publicEvents.length + 1 })
      }
      if (timeout.timedOut()) throw new TransportError(`stream timed out after ${timeoutMs}ms`, { code: 'timeout', retryable: true })
      const parsedTools = [...toolCalls.values()].map(row => {
        let args = row.argumentsText
        try { args = JSON.parse(row.argumentsText || '{}') } catch {}
        return { callId: row.callId, name: row.name, arguments: args }
      })
      attempts.push({ schema: LLM_TRANSPORT_ATTEMPT_SCHEMA, attempt, startedAt, durationMs: Date.now() - startedMs, status: 'completed', providerRequestId: completedMeta?.providerRequestId || null })
      return {
        schema: LLM_TRANSPORT_RESULT_SCHEMA,
        status: 'completed',
        callId,
        output: text,
        toolCalls: parsedTools,
        usage: completedMeta?.usage || null,
        providerRequestId: completedMeta?.providerRequestId || null,
        attempts,
        streamAudit: { eventCount: publicEvents.length, partialsCommittedToProfile: false },
      }
    } catch (error) {
      let failure = classifyTransportFailure(error)
      if (timeout.timedOut()) failure = new TransportError(`stream timed out after ${timeoutMs}ms`, { code: 'timeout', retryable: true, cause: error })
      attempts.push({ schema: LLM_TRANSPORT_ATTEMPT_SCHEMA, attempt, startedAt, durationMs: Date.now() - startedMs, status: 'failed', error: { code: failure.code, message: failure.message, status: failure.status || null, retryable: failure.retryable } })
      if (options.signal?.aborted) return { schema: LLM_TRANSPORT_RESULT_SCHEMA, status: 'cancelled', callId, attempts, error: attempts.at(-1).error, streamAudit: { partialsCommittedToProfile: false } }
      if (!failure.retryable || attempt === maxAttempts) return { schema: LLM_TRANSPORT_RESULT_SCHEMA, status: 'failed', callId, attempts, error: attempts.at(-1).error, streamAudit: { partialsCommittedToProfile: false } }
      await sleep(defaultBackoffMs(attempt, baseBackoffMs))
    } finally {
      timeout.cleanup()
    }
  }
  return { schema: LLM_TRANSPORT_RESULT_SCHEMA, status: 'failed', callId, attempts, error: { code: 'exhausted', message: 'retry budget exhausted' }, streamAudit: { partialsCommittedToProfile: false } }
}

export function assertModelIndependence(agentTransport, judgeTransport, mode = 'preferred') {
  if (!['required', 'preferred', 'disabled'].includes(mode)) throw new Error(`Unsupported independence mode ${mode}`)
  if (mode === 'disabled') return { ok: true, independent: null, mode, warnings: [] }
  const a = agentTransport?.identity || transportIdentity()
  const j = judgeTransport?.identity || transportIdentity()
  const independent = a.independenceGroup !== j.independenceGroup
  if (!independent && mode === 'required') {
    throw new Error(`Agent/Judge independence required but both use independenceGroup=${a.independenceGroup}`)
  }
  return {
    ok: true,
    independent,
    mode,
    warnings: independent ? [] : ['agent-and-judge-share-independence-group'],
    agent: a,
    judge: j,
  }
}

export class SessionWriteCoordinator {
  #tails = new Map()

  pendingSessions() { return this.#tails.size }

  async runExclusive(sessionId, task) {
    if (typeof task !== 'function') throw new Error('task must be function')
    const key = String(sessionId)
    const previous = this.#tails.get(key) || Promise.resolve()
    let release
    const current = new Promise(resolve => { release = resolve })
    const tail = previous.then(() => current, () => current)
    this.#tails.set(key, tail)
    await previous.catch(() => {})
    try {
      return await task()
    } finally {
      release()
      if (this.#tails.get(key) === tail) this.#tails.delete(key)
    }
  }
}

export class SessionLeaseCoordinator {
  #active = new Set()

  activeSessions() { return this.#active.size }

  async tryRunExclusive(sessionId, task) {
    if (typeof task !== 'function') throw new Error('task must be function')
    const key = String(sessionId)
    if (this.#active.has(key)) return { acquired: false, reason: 'session-busy' }
    this.#active.add(key)
    try {
      return { acquired: true, value: await task() }
    } finally {
      this.#active.delete(key)
    }
  }
}
