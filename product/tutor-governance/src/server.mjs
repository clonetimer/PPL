import http from 'node:http'
import { TutorGovernanceService } from './tutor-service.mjs'
import { readJson, sendJson, statusForError, urlParts } from '@ppl/platform-core'

export function createTutorGovernanceServer(options = {}) {
  const service = options.service || new TutorGovernanceService(options)
  const server = http.createServer(async (req, res) => {
    try {
      const p = urlParts(req)
      if (req.method === 'GET' && p.join('/') === 'health') return sendJson(res, 200, { ok: true, product: '@ppl/product-tutor-governance', version: '1.0.0-dev.3' })
      if (p.join('/') === 'v1/sessions' && req.method === 'POST') return sendJson(res, 201, service.createSession(await readJson(req)))
      if (p.join('/') === 'v1/sessions' && req.method === 'GET') return sendJson(res, 200, { sessions: service.listSessions() })
      if (p[0] === 'v1' && p[1] === 'sessions' && p[2]) {
        const id = p[2]
        if (req.method === 'GET' && p.length === 3) return sendJson(res, 200, service.getSession(id))
        if (req.method === 'GET' && p[3] === 'summary') return sendJson(res, 200, service.getSummary(id))
        if (req.method === 'GET' && p[3] === 'audit') return sendJson(res, 200, { audit: service.getAudit(id) })
        if (req.method === 'POST' && p[3] === 'observations') return sendJson(res, 200, service.observe(id, await readJson(req)))
        if (req.method === 'POST' && p[3] === 'affect') return sendJson(res, 200, service.observeAffect(id, await readJson(req)))
        if (req.method === 'POST' && p[3] === 'interventions') return sendJson(res, 200, service.recordIntervention(id, await readJson(req)))
        if (req.method === 'POST' && p[3] === 'verifications') return sendJson(res, 200, service.verifyIntervention(id, await readJson(req)))
      }
      return sendJson(res, 404, { error: 'not-found' })
    } catch (error) { return sendJson(res, statusForError(error), { error: error.message, code: error.code || null }) }
  })
  return { server, service }
}
