export function modelsEndpointFromChatEndpoint(endpoint) {
  const url = new URL(endpoint)
  url.pathname = '/v1/models'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function hintTokens(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean)
}

export function resolveVisibleModel(modelIds = [], { model = '', hint = '' } = {}) {
  const ids = [...new Set((modelIds || []).filter(Boolean).map(String))]
  if (model) {
    const exact = ids.find(id => id === model) || ids.find(id => id.toLowerCase() === model.toLowerCase())
    if (exact) return { status: 'selected', selectedModel: exact, match: 'explicit-exact', candidates: [exact] }
    return { status: 'model-not-found', selectedModel: null, requestedModel: model, candidates: ids }
  }
  if (!hint) {
    if (ids.length === 1) return { status: 'selected', selectedModel: ids[0], match: 'single-visible-model', candidates: ids }
    return { status: ids.length ? 'model-required' : 'no-models-visible', selectedModel: null, candidates: ids }
  }
  const nHint = normalize(hint)
  const exactNormalized = ids.filter(id => normalize(id) === nHint)
  if (exactNormalized.length === 1) return { status: 'selected', selectedModel: exactNormalized[0], match: 'normalized-exact', candidates: exactNormalized }
  const tokens = hintTokens(hint)
  const scored = ids.map(id => {
    const lower = id.toLowerCase()
    const n = normalize(id)
    let score = n.includes(nHint) ? 100 : 0
    score += tokens.reduce((acc, token) => acc + (lower.includes(token) ? 10 : 0), 0)
    if (lower.includes('qwen3.5') && String(hint).toLowerCase().includes('qwen3.5')) score += 25
    if (lower.includes('0.8b') && String(hint).toLowerCase().includes('0.8b')) score += 25
    return { id, score }
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id))
  if (!scored.length) return { status: 'model-not-found', selectedModel: null, modelHint: hint, candidates: ids }
  const best = scored[0].score
  const bestIds = scored.filter(x => x.score === best).map(x => x.id)
  if (bestIds.length === 1) return { status: 'selected', selectedModel: bestIds[0], match: 'fuzzy-hint', candidates: bestIds }
  return { status: 'model-ambiguous', selectedModel: null, modelHint: hint, candidates: bestIds }
}

export async function discoverVisibleModels({ endpoint, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Model discovery requires fetch')
  const modelsEndpoint = modelsEndpointFromChatEndpoint(endpoint)
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : undefined
  const response = await fetchImpl(modelsEndpoint, { headers, signal: AbortSignal.timeout(timeoutMs) })
  let data = null
  try { data = await response.json() } catch {}
  if (!response.ok) {
    const message = data?.error?.message || `Model discovery HTTP ${response.status}`
    const error = new Error(message); error.status = response.status; throw error
  }
  const modelIds = Array.isArray(data?.data) ? data.data.map(x => x?.id).filter(Boolean) : []
  return { modelsEndpoint, modelIds, raw: data }
}
