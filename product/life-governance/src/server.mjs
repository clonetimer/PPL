import http from 'node:http'
import { LifeGovernanceService } from './life-service.mjs'
import { readJson, sendJson, statusForError, urlParts } from '@ppl/platform-core'
export function createLifeGovernanceServer(options = {}) {
  const service = options.service || new LifeGovernanceService(options)
  const server = http.createServer(async (req, res) => {
    try {
      const p = urlParts(req)
      if (req.method === 'GET' && p.join('/') === 'health') return sendJson(res, 200, { ok: true, product: '@ppl/product-life-governance', version: '1.0.0-dev.3' })
      if (p.join('/') === 'v1/sessions' && req.method === 'POST') return sendJson(res, 201, service.createSession(await readJson(req)))
      if (p.join('/') === 'v1/sessions' && req.method === 'GET') return sendJson(res, 200, { sessions: service.listSessions() })
      if (p[0] === 'v1' && p[1] === 'sessions' && p[2]) {
        const id = p[2]
        if (req.method === 'GET' && p.length === 3) return sendJson(res, 200, service.getSession(id))
        if (req.method === 'GET' && p[3] === 'audit') return sendJson(res, 200, { audit: service.getAudit(id) })
        if (req.method === 'POST' && p[3] === 'requests') return sendJson(res, 201, service.compileTurn(id, await readJson(req)))
        if (req.method === 'POST' && p[3] === 'responses') return sendJson(res, 200, service.applyResponse(id, await readJson(req)))
        if (req.method === 'POST' && p[3] === 'preferences') return sendJson(res, 200, service.setPreference(id, await readJson(req)))
        if (req.method === 'POST' && p[3] === 'plans') return sendJson(res, 200, service.setPlan(id, await readJson(req)))
        if (req.method === 'POST' && p[3] === 'realtime') return sendJson(res, 200, service.observeRealtime(id, await readJson(req)))
        if (req.method === 'POST' && p[3] === 'risk') return sendJson(res, 200, service.escalateHighRisk(id, await readJson(req)))
      }
      return sendJson(res, 404, { error: 'not-found' })
    } catch (error) { return sendJson(res, statusForError(error), { error: error.message, code: error.code || null }) }
  })
  return { server, service }
}
