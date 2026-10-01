import http from 'node:http'
import { ResearchGovernanceService } from './research-governance.mjs'

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body, null, 2))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
  })
  res.end(data)
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text)
}

function pathParts(url) {
  return new URL(url, 'http://localhost').pathname.split('/').filter(Boolean)
}

export function createResearchGovernanceServer(options = {}) {
  const service = options.service || new ResearchGovernanceService(options)
  const server = http.createServer(async (req, res) => {
    try {
      const parts = pathParts(req.url)
      if (req.method === 'GET' && parts.join('/') === 'health') return json(res, 200, { ok: true, product: '@ppl/product-research-governance', version: '1.0.0-dev.3' })
      if (req.method === 'GET' && parts.join('/') === 'v1/sessions') return json(res, 200, { sessions: service.listSessions() })
      if (req.method === 'POST' && parts.join('/') === 'v1/sessions') return json(res, 201, service.createSession(await readJson(req)))
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2]) {
        const sessionId = decodeURIComponent(parts[2])
        if (req.method === 'GET' && parts.length === 3) return json(res, 200, service.getSession(sessionId))
        if (req.method === 'POST' && parts[3] === 'claims') return json(res, 201, service.addClaim(sessionId, await readJson(req)))
        if (req.method === 'GET' && parts[3] === 'evidence') return json(res, 200, { evidence: service.getEvidence(sessionId) })
        if (req.method === 'POST' && parts[3] === 'handoffs') return json(res, 201, service.createHandoff(sessionId, await readJson(req)))
        if (req.method === 'POST' && parts[3] === 'fidelity') return json(res, 200, service.assessHandoff(sessionId, await readJson(req)))
        if (req.method === 'POST' && parts[3] === 'deliveries' && parts.length === 4) return json(res, 201, service.prepareDelivery(sessionId, await readJson(req)))
        if (req.method === 'POST' && parts[3] === 'deliveries' && parts[4] && parts[5] === 'finalize') {
          const body = await readJson(req)
          return json(res, 200, service.finalizeDelivery(sessionId, { ...body, deliveryId: decodeURIComponent(parts[4]) }))
        }
        if (req.method === 'GET' && parts[3] === 'audit') return json(res, 200, { audit: service.getAudit(sessionId) })
      }
      return json(res, 404, { error: 'not-found' })
    } catch (error) {
      const status = /unknown session|unknown handoffId|unknown deliveryId/.test(error.message) ? 404 : 400
      return json(res, status, { error: error.message })
    }
  })
  return { server, service }
}

export async function listenResearchGovernanceServer(options = {}) {
  const host = options.host || process.env.PPL_HOST || '127.0.0.1'
  const port = Number(options.port ?? process.env.PPL_PORT ?? 8787)
  const { server, service } = createResearchGovernanceServer(options)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  return { server, service, host, port: server.address().port }
}
