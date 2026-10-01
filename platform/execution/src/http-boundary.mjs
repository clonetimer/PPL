// Finite, non-streaming HTTP calls for the configured product execution plane.
// No redirects are followed, including same-origin redirects; use the final endpoint.
export function boundaryError(code, message) { const error = new Error(message); error.code = code; return error }
export function boundedInteger(value, name, fallback, min, max) {
  const number = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) throw boundaryError('INVALID_EXECUTION_LIMIT', `${name} must be an integer between ${min} and ${max}`)
  return number
}
export function assertProductEndpoint(endpoint, allowRemoteEndpoint = false) {
  let url
  try { url = new URL(endpoint) } catch { throw boundaryError('INVALID_ENDPOINT', 'Execution endpoint must be an absolute HTTP(S) URL') }
  if (!['http:', 'https:'].includes(url.protocol)) throw boundaryError('INVALID_ENDPOINT', 'Execution endpoint must use HTTP(S)')
  if (url.username || url.password || url.hash) throw boundaryError('INVALID_ENDPOINT', 'Endpoint userinfo and fragments are not allowed; use API key environment variables')
  if (!['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname) && !allowRemoteEndpoint) throw boundaryError('REMOTE_ENDPOINT_DISABLED', 'Non-loopback execution endpoints require explicit remote opt-in')
  return url
}
export function createBoundedFetch(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('Execution requires fetch')
  const timeoutMs = boundedInteger(options.timeoutMs, 'HTTP timeoutMs', 30000, 1, 300000)
  const maxBytes = boundedInteger(options.maxBytes, 'HTTP maxBytes', 2097152, 1, 16777216)
  return async function boundedFetch(url, init = {}) {
    const deadline = AbortSignal.timeout(timeoutMs)
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline
    let reader
    try {
      signal.throwIfAborted()
      const response = await fetchImpl(url, { ...init, signal, redirect: 'manual' })
      if ((response.status >= 300 && response.status < 400) || response.redirected) {
        await response.body?.cancel().catch(() => {})
        throw boundaryError('HTTP_REDIRECT_BLOCKED', 'Execution HTTP redirects are not allowed')
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => {})
        throw boundaryError('HTTP_BODY_TOO_LARGE', 'Execution HTTP response exceeds the byte limit')
      }
      const chunks=[]; let size=0
      reader = response.body?.getReader()
      if (reader) while (true) {
        signal.throwIfAborted()
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) { await reader.cancel().catch(() => {}); throw boundaryError('HTTP_BODY_TOO_LARGE', 'Execution HTTP response exceeds the byte limit') }
        chunks.push(value)
      }
      signal.throwIfAborted()
      // Strip upstream error text: it can reflect credentials or arbitrary private content.
      const headers = new Headers(response.headers)
      headers.delete('content-encoding'); headers.delete('content-length')
      const body = [204,205,304].includes(response.status) ? null : response.ok ? Buffer.concat(chunks) : JSON.stringify({error:{message:`Execution backend HTTP ${response.status}`}})
      return new Response(body, { status: response.status, statusText: response.statusText, headers })
    } catch (error) {
      if (init.signal?.aborted) throw boundaryError('HTTP_ABORTED', 'Execution HTTP request was cancelled')
      if (deadline.aborted) throw boundaryError('HTTP_TIMEOUT', 'Execution HTTP deadline exceeded')
      if (['HTTP_REDIRECT_BLOCKED','HTTP_BODY_TOO_LARGE'].includes(error.code)) throw error
      throw boundaryError('HTTP_NETWORK_ERROR', 'Execution HTTP request failed')
    } finally { try { reader?.releaseLock() } catch {} }
  }
}
