import crypto from 'node:crypto'
import { assertProductEndpoint, boundedInteger, boundaryError, createBoundedFetch } from './http-boundary.mjs'
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const idFor = value => `doc_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,16)}`
function requestInput(input = {}) {
  const limit = boundedInteger(input.limit, 'retrieval limit', 5, 1, 20)
  if (input.query !== undefined && typeof input.query !== 'string') throw boundaryError('RETRIEVAL_QUERY_INVALID', 'Retrieval query must be text')
  const query = input.query || ''
  if (query.length > 4000) throw boundaryError('RETRIEVAL_QUERY_INVALID', 'Retrieval query exceeds 4000 characters')
  return { query, limit }
}
function normalizeDocument(doc, index = 0, maxDocumentChars = 50000) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw boundaryError('RETRIEVAL_DOCUMENT_INVALID', 'Retrieval document must be an object')
  const raw = doc.text ?? doc.content ?? doc.snippet
  if (typeof raw !== 'string' || !raw.trim()) throw boundaryError('RETRIEVAL_DOCUMENT_INVALID', 'Retrieval document requires nonempty text/content/snippet')
  const text = raw.trim()
  if (text.length > maxDocumentChars) throw boundaryError('RETRIEVAL_DOCUMENT_TOO_LARGE', 'Retrieval document exceeds the configured character limit')
  const url = doc.url ? String(doc.url) : null
  return {
    documentId: String(doc.documentId || doc.id || idFor(url || `${index}:${text}`)),
    title: String(doc.title || `Document ${index + 1}`), url, text,
    retrievedAt: String(doc.retrievedAt || new Date().toISOString()),
    score: doc.score !== null && doc.score !== undefined && Number.isFinite(Number(doc.score)) ? Number(doc.score) : null,
    metadata: clone(doc.metadata || {}),
  }
}
function httpOptions(options, fallback) {
  const endpoint = options.endpoint || fallback
  assertProductEndpoint(endpoint, Boolean(options.allowRemoteEndpoint))
  return { endpoint,
    fetchImpl: createBoundedFetch({ fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, maxBytes: options.maxBytes }),
    maxDocumentChars: boundedInteger(options.maxDocumentChars, 'maxDocumentChars', 50000, 1, 200000),
    headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {} }
}
async function jsonBody(response) {
  if (!response.ok) throw boundaryError('RETRIEVAL_HTTP_ERROR', `Retrieval backend HTTP ${response.status}`)
  try { return await response.json() } catch { throw boundaryError('RETRIEVAL_INVALID_JSON', 'Retrieval backend returned invalid JSON') }
}
function rowsFrom(data, field, fallback) {
  const rows = data?.[field] ?? (fallback ? data?.[fallback] : undefined)
  if (!Array.isArray(rows)) throw boundaryError('RETRIEVAL_CONTRACT_INVALID', 'Retrieval response requires a documents/results array')
  if (rows.length > 100) throw boundaryError('RETRIEVAL_DOCUMENT_LIMIT', 'Retrieval response exceeds 100 documents')
  return rows
}
export function createStaticRetrievalProvider(documents = []) {
  const rows = documents.map((doc, i) => normalizeDocument(doc, i))
  return { kind:'static-retrieval', async retrieve(input = {}) {
    const { query, limit } = requestInput(input)
    input.signal?.throwIfAborted()
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x => x.length > 1)
    const scored = rows.map((row, index) => ({ row, index, score: terms.reduce((n, term) => n + (`${row.title} ${row.text}`.toLowerCase().includes(term) ? 1 : 0), 0) }))
      .sort((a,b) => b.score - a.score || a.index - b.index)
    return { query, documents: scored.slice(0,limit).map(x => ({ ...clone(x.row), score:x.row.score ?? x.score })) }
  } }
}
export function createHttpJsonRetrievalProvider(options = {}) {
  const config = httpOptions(options, 'http://127.0.0.1:8790/retrieve')
  return { kind:'http-json-retrieval', endpoint:config.endpoint, async retrieve(input = {}) {
    const { query, limit } = requestInput(input)
    const response = await config.fetchImpl(config.endpoint, { method:'POST',
      headers:{ 'content-type':'application/json', ...config.headers },
      body:JSON.stringify({ query, limit, filters:input.filters || {} }), signal:input.signal })
    const data = await jsonBody(response)
    const rows = rowsFrom(data, 'documents', 'results')
    const documents = rows.slice(0,limit).map((doc,i) => normalizeDocument(doc,i,config.maxDocumentChars))
    return { query, documents, raw:{ resultCount:rows.length } }
  } }
}
export function createSearxngRetrievalProvider(options = {}) {
  const config = httpOptions(options, 'http://127.0.0.1:8080/search')
  return { kind:'searxng-retrieval', endpoint:config.endpoint, async retrieve(input = {}) {
    const { query, limit } = requestInput(input)
    const url = new URL(config.endpoint); url.searchParams.set('q',query); url.searchParams.set('format','json')
    if (options.language) url.searchParams.set('language',options.language)
    const response = await config.fetchImpl(url, { headers:config.headers, signal:input.signal })
    const data = await jsonBody(response)
    const rows = rowsFrom(data,'results')
    const documents = rows.slice(0,limit).map((row,i) => normalizeDocument({
      id:row.url || `${i}`, title:row.title, url:row.url, text:row.content || row.title, score:row.score,
      metadata:{ engine:row.engine || null, engines:row.engines || [], sourceKind:'search-snippet' },
    },i,config.maxDocumentChars))
    return { query, documents, raw:{ resultCount:data.number_of_results ?? rows.length } }
  } }
}
