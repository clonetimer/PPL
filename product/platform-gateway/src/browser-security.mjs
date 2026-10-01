/** Local-owner console protections; these are not user authentication or multi-tenancy. */
export function applyBrowserHeaders(res) {
  res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'")
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('cross-origin-resource-policy', 'same-origin')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
}
function deny(code, message, status = 403) { const error = new Error(message); error.code = code; error.httpStatus = status; throw error }
export function guardBrowserRequest(req, options = {}) {
  const hostHeader = String(req.headers.host || '')
  let host
  try {
    const url = new URL(`http://${hostHeader}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !hostHeader || url.host !== hostHeader.toLowerCase()) deny('HOST_NOT_ALLOWED', 'invalid Host header')
    host = url.hostname
  } catch { deny('HOST_NOT_ALLOWED', 'invalid Host header') }
  const allowed = options.allowedHosts || ['127.0.0.1', 'localhost', '[::1]']
  if (!allowed.includes(host)) deny('HOST_NOT_ALLOWED', 'Host is not allowed by the local console')
  const origin = req.headers.origin
  const protocol = req.socket.encrypted ? 'https' : 'http'
  if (origin !== undefined && origin !== `${protocol}://${hostHeader}`) deny('ORIGIN_NOT_ALLOWED', 'cross-origin access is not allowed')
  if (req.headers['sec-fetch-site'] === 'cross-site') deny('CROSS_SITE_REQUEST', 'cross-site access is not allowed')
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/json') deny('JSON_CONTENT_TYPE_REQUIRED', 'application/json is required', 415)
    if (Number(req.headers['content-length']) > 1024 * 1024) { req.resume(); deny('BODY_TOO_LARGE', 'JSON body exceeds 1 MiB', 413) }
  }
}
