import http from 'node:http'
import { serveObservatoryAsset, routeObservatory, storedExecutions, storedExecution, redact } from '@ppl/product-observatory'
import { applyBrowserHeaders, guardBrowserRequest } from './browser-security.mjs'
import { createProductStore, readJson, sendJson, statusForError, urlParts } from '@ppl/platform-core'
import { AgentGovernanceService, AgentExecutionService } from '@ppl/product-agent-governance'
import { ResearchGovernanceService, ResearchExecutionService } from '@ppl/product-research-governance'
import { TutorGovernanceService } from '@ppl/product-tutor-governance'
import { LifeGovernanceService } from '@ppl/product-life-governance'
import { CharacterGovernanceService } from '@ppl/product-character-governance'

export const PPL_PRODUCT_APPS = Object.freeze([
  { id: 'agent', product: '@ppl/product-agent-governance', boundary: 'generic authority + context projection + handoff fidelity' },
  { id: 'research', product: '@ppl/product-research-governance', boundary: 'canonical evidence + multi-agent handoff fidelity + delivery binding' },
  { id: 'tutor', product: '@ppl/product-tutor-governance', boundary: 'learner evidence + mastery uncertainty + intervention verification' },
  { id: 'life', product: '@ppl/product-life-governance', boundary: 'durable preference/plan + realtime fact isolation + high-risk escalation' },
  { id: 'character', product: '@ppl/product-character-governance', boundary: 'durable relationship state + deterministic event transitions' },
])

export function createPlatformRuntime(options = {}) {
  const store = options.store || createProductStore(options.storeOptions || {})
  const agent = options.agent || new AgentGovernanceService({ store })
  const research = options.research || new ResearchGovernanceService({ store })
  const deps = options.executionDependencies || null
  const agentExecution = options.agentExecution || (deps?.enabled && deps.modelTransport ? new AgentExecutionService({ governanceService: agent, modelTransport: deps.modelTransport, transportOptions:deps.transportOptions, store }) : null)
  const researchExecution = options.researchExecution || (deps?.enabled && deps.modelTransport && deps.judgeTransport && deps.retrievalProvider ? new ResearchExecutionService({ researchService: research, retrievalProvider: deps.retrievalProvider, modelTransport: deps.modelTransport, judgeTransport: deps.judgeTransport, independenceMode: deps.independenceMode || 'preferred', transportOptions:deps.transportOptions, store }) : null)
  return {
    store, agent, research,
    tutor: options.tutor || new TutorGovernanceService({ store }),
    life: options.life || new LifeGovernanceService({ store }),
    character: options.character || new CharacterGovernanceService({ store }),
    agentExecution, researchExecution,
    executionSummary: deps?.summary || { enabled: Boolean(agentExecution || researchExecution) },
  }
}

function requireExecution(service, name) {
  if (service) return service
  const error = new Error(`${name} execution is not configured`)
  error.code = 'EXECUTION_NOT_CONFIGURED'
  throw error
}


async function routeAgent(service, execution, req, res, p, runtime) {
  if (p[0] !== 'sessions') return false
  if (p.length === 1 && req.method === 'GET') { sendJson(res, 200, { sessions: service.listSessions() }); return true }
  if (p.length === 1 && req.method === 'POST') { sendJson(res, 201, service.createSession(await readJson(req))); return true }
  const id = p[1]; if (!id) return false
  if (p.length === 2 && req.method === 'GET') { sendJson(res, 200, service.getSession(id)); return true }
  if (p[2] === 'audit' && p.length === 3 && req.method === 'GET') { sendJson(res, 200, { audit: service.getAudit(id) }); return true }
  if (p[2] === 'context' && p.length === 3 && req.method === 'PUT') { sendJson(res, 200, service.replaceContext(id, await readJson(req))); return true }
  if (p[2] === 'handoffs' && p.length === 3 && req.method === 'POST') { sendJson(res, 201, service.createHandoff(id, await readJson(req))); return true }
  if (p[2] === 'fidelity' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.assessHandoff(id, await readJson(req))); return true }
  if (p[2] === 'executions' && p.length === 3 && req.method === 'GET') { const runs=redact(storedExecutions(runtime, 'agent', id)); sendJson(res,200,{executions:runs}); return true }
  if (p[2] === 'executions' && p[3] && p.length === 4 && req.method === 'GET') { const run=redact(storedExecution(runtime, 'agent', id, p[3])); sendJson(res,200,run); return true }
  return false
}

async function routeResearch(service, execution, req, res, p, runtime) {
  if (p[0] !== 'sessions') return false
  if (p.length === 1 && req.method === 'GET') { sendJson(res, 200, { sessions: service.listSessions() }); return true }
  if (p.length === 1 && req.method === 'POST') { sendJson(res, 201, service.createSession(await readJson(req))); return true }
  const id = p[1]; if (!id) return false
  if (p.length === 2 && req.method === 'GET') { sendJson(res, 200, service.getSession(id)); return true }
  if (p[2] === 'claims' && p.length === 3 && req.method === 'POST') { sendJson(res, 201, service.addClaim(id, await readJson(req))); return true }
  if (p[2] === 'evidence' && p.length === 3 && req.method === 'GET') { sendJson(res, 200, { evidence: service.getEvidence(id) }); return true }
  if (p[2] === 'handoffs' && p.length === 3 && req.method === 'POST') { sendJson(res, 201, service.createHandoff(id, await readJson(req))); return true }
  if (p[2] === 'fidelity' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.assessHandoff(id, await readJson(req))); return true }
  if (p[2] === 'deliveries' && p.length === 3 && req.method === 'POST') { sendJson(res, 201, service.prepareDelivery(id, await readJson(req))); return true }
  if (p[2] === 'deliveries' && p[3] && p[4] === 'finalize' && p.length === 5 && req.method === 'POST') { sendJson(res, 200, service.finalizeDelivery(id, { ...(await readJson(req)), deliveryId: p[3] })); return true }
  if (p[2] === 'audit' && p.length === 3 && req.method === 'GET') { sendJson(res, 200, { audit: service.getAudit(id) }); return true }
  if (p[2] === 'executions' && p.length === 3 && req.method === 'GET') { const runs=redact(storedExecutions(runtime, 'research', id)); sendJson(res,200,{executions:runs}); return true }
  if (p[2] === 'executions' && p[3] && p.length === 4 && req.method === 'GET') { const run=redact(storedExecution(runtime, 'research', id, p[3])); sendJson(res,200,run); return true }
  return false
}

async function routeTutor(service, req, res, p) {
  if (p[0] !== 'sessions') return false
  if (p.length === 1 && req.method === 'GET') { sendJson(res, 200, { sessions: service.listSessions() }); return true }
  if (p.length === 1 && req.method === 'POST') { sendJson(res, 201, service.createSession(await readJson(req))); return true }
  const id = p[1]; if (!id) return false
  if (p.length === 2 && req.method === 'GET') { sendJson(res, 200, service.getSession(id)); return true }
  if (p[2] === 'summary' && p.length === 3 && req.method === 'GET') { sendJson(res, 200, service.getSummary(id)); return true }
  if (p[2] === 'audit' && p.length === 3 && req.method === 'GET') { sendJson(res, 200, { audit: service.getAudit(id) }); return true }
  if (p[2] === 'observations' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.observe(id, await readJson(req))); return true }
  if (p[2] === 'affect' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.observeAffect(id, await readJson(req))); return true }
  if (p[2] === 'interventions' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.recordIntervention(id, await readJson(req))); return true }
  if (p[2] === 'verifications' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.verifyIntervention(id, await readJson(req))); return true }
  return false
}

async function routeLife(service, req, res, p) {
  if (p[0] !== 'sessions') return false
  if (p.length === 1 && req.method === 'GET') { sendJson(res, 200, { sessions: service.listSessions() }); return true }
  if (p.length === 1 && req.method === 'POST') { sendJson(res, 201, service.createSession(await readJson(req))); return true }
  const id = p[1]; if (!id) return false
  if (p.length === 2 && req.method === 'GET') { sendJson(res, 200, service.getSession(id)); return true }
  if (p[2] === 'audit' && p.length === 3 && req.method === 'GET') { sendJson(res, 200, { audit: service.getAudit(id) }); return true }
  if (p[2] === 'requests' && p.length === 3 && req.method === 'POST') { sendJson(res, 201, service.compileTurn(id, await readJson(req))); return true }
  if (p[2] === 'responses' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.applyResponse(id, await readJson(req))); return true }
  if (p[2] === 'preferences' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.setPreference(id, await readJson(req))); return true }
  if (p[2] === 'plans' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.setPlan(id, await readJson(req))); return true }
  if (p[2] === 'realtime' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.observeRealtime(id, await readJson(req))); return true }
  if (p[2] === 'risk' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.escalateHighRisk(id, await readJson(req))); return true }
  return false
}

async function routeCharacter(service, req, res, p) {
  if (p[0] !== 'sessions') return false
  if (p.length === 1 && req.method === 'GET') { sendJson(res, 200, { sessions: service.listSessions() }); return true }
  if (p.length === 1 && req.method === 'POST') { sendJson(res, 201, service.createSession(await readJson(req))); return true }
  const id = p[1]; if (!id) return false
  if (p.length === 2 && req.method === 'GET') { sendJson(res, 200, service.getSession(id)); return true }
  if (p[2] === 'audit' && p.length === 3 && req.method === 'GET') { sendJson(res, 200, { audit: service.getAudit(id) }); return true }
  if (p[2] === 'events' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.applyEvent(id, await readJson(req))); return true }
  if (p[2] === 'comfort' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.comfort(id, await readJson(req))); return true }
  if (p[2] === 'confession' && p.length === 3 && req.method === 'POST') { sendJson(res, 200, service.confess(id, await readJson(req))); return true }
  return false
}

export function createPlatformGateway(options = {}) {
  const runtime = options.runtime || createPlatformRuntime(options)
  const inFlight = new Set()
  const server = http.createServer({ requestTimeout: 60000, headersTimeout: 15000, maxHeaderSize: 16384 }, async (req, res) => {
    applyBrowserHeaders(res)
    try {
      guardBrowserRequest(req, options.browserSecurity || {})
      const url = new URL(req.url, 'http://localhost')
      if (serveObservatoryAsset(req, res, url.pathname)) return
      const p = urlParts(req)
      if (routeObservatory(req, res, p, runtime)) return
      if (req.method === 'POST' && p.length === 5 && p[0] === 'v1' && ['agent', 'research'].includes(p[1]) && p[2] === 'sessions' && p[4] === 'execute') {
        const app = p[1], id = p[3], key = JSON.stringify([app, id])
        runtime[app].getSession(id)
        const execution = requireExecution(runtime[`${app}Execution`], app)
        const input = await readJson(req)
        if (inFlight.has(key)) { const error = new Error('execution already in progress for this session'); error.code = 'EXECUTION_IN_PROGRESS'; throw error }
        inFlight.add(key)
        try { return sendJson(res, 200, app === 'agent' ? await execution.executeHandoff(id, input) : await execution.run(id, input)) }
        finally { inFlight.delete(key) }
      }
      if (req.method === 'GET' && p.join('/') === 'health') return sendJson(res, 200, { ok: true, product: '@ppl/product-platform-gateway', version: '1.0.0-dev.5', apps: PPL_PRODUCT_APPS.map(x => x.id), execution: { agent: Boolean(runtime.agentExecution), research: Boolean(runtime.researchExecution), config: redact(runtime.executionSummary) } })
      if (req.method === 'GET' && p.join('/') === 'v1/apps') return sendJson(res, 200, { apps: PPL_PRODUCT_APPS })
      if (p[0] === 'v1' && p[1]) {
        const sub = p.slice(2)
        const handled = p[1] === 'agent' ? await routeAgent(runtime.agent, runtime.agentExecution, req, res, sub, runtime)
          : p[1] === 'research' ? await routeResearch(runtime.research, runtime.researchExecution, req, res, sub, runtime)
          : p[1] === 'tutor' ? await routeTutor(runtime.tutor, req, res, sub)
          : p[1] === 'life' ? await routeLife(runtime.life, req, res, sub)
          : p[1] === 'character' ? await routeCharacter(runtime.character, req, res, sub)
          : false
        if (handled) return
      }
      return sendJson(res, 404, { error: 'not-found' })
    } catch (error) { return sendJson(res, statusForError(error), { error: error.message, code: error.code || null }) }
  })
  return { server, runtime }
}
