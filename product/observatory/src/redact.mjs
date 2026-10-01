// Best-effort credential minimization for the local observability surface, NOT a DLP guarantee.
// The canonical stored record is never changed. Arbitrary business text may remain sensitive.
const credentialKey = /^(?:authorization|proxyauthorization|cookie|setcookie|token|password|passwd|secret|clientsecret|apikey|accesstoken|refreshtoken|idtoken|privatekey|credential|credentials)$/i
const keyIsSecret = key => credentialKey.test(String(key).replace(/[-_\s]/g, ''))
const marker = '[REDACTED]'
function cleanText(text) {
  // URL userinfo and known credential query arguments are not useful observability data.
  let out = text.replace(/https?:\/\/[^\s"<>]+/gi, raw => {
    try {
      const url = new URL(raw)
      if (!url.username && !url.password && ![...url.searchParams.keys()].some(keyIsSecret)) return raw
      url.username = ''; url.password = ''
      for (const key of [...url.searchParams.keys()]) if (keyIsSecret(key)) url.searchParams.set(key, marker)
      return url.toString()
    } catch { return raw }
  })
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${marker}`)
  // Provider output is often JSON serialized into a string; recurse if it actually is JSON.
  if (/^\s*[\[{]/.test(out)) {
    try { return JSON.stringify(redact(JSON.parse(out))) } catch { /* ordinary text */ }
  }
  return out
}
export function redact(value) {
  if (typeof value === 'string') return cleanText(value)
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, keyIsSecret(key) ? marker : redact(item)]))
  return value
}
