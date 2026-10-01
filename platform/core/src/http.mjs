export function sendJson(res, status, body) {
  if (res.writableEnded || res.destroyed) return
  const data = Buffer.from(JSON.stringify(body, null, 2))
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store' })
  res.end(data)
}
export function readJson(req, options = {}) {
  const maxBytes = options.maxBytes ?? 1024 * 1024
  return new Promise((resolve, reject) => {
    let chunks = [], bytes = 0, exceeded = false
    req.on('data', chunk => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        if (!exceeded) { exceeded = true; chunks = []; const error = new Error('JSON body exceeds 1 MiB'); error.code = 'BODY_TOO_LARGE'; reject(error) }
        return // Drain the rest without retaining it; the caller can still send HTTP 413.
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (exceeded) return
      try {
        const value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('JSON body must be an object')
        resolve(value)
      } catch (error) { reject(error) }
    })
    req.on('error', reject)
    req.on('aborted', () => reject(new Error('request aborted')))
  })
}
export function urlParts(req) {
  return new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean).map(decodeURIComponent)
}
export function statusForError(error) {
  const message = String(error?.message || '')
  if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 400 && error.httpStatus <= 599) return error.httpStatus
  if (error?.code === 'NOT_FOUND' || /unknown session|not found|unknown handoffId|unknown deliveryId|unknown execution run/.test(message)) return 404
  if (['REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'EXECUTION_IN_PROGRESS'].includes(error?.code) || /already exists/.test(message)) return 409
  if (error?.code === 'BODY_TOO_LARGE') return 413
  if (error?.code === 'EXECUTION_NOT_CONFIGURED') return 503
  return 400
}
