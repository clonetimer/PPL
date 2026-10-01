import { APP_CATALOG, OBSERVATORY_VERSION, assertApp } from './catalog.mjs'
import { redact } from './redact.mjs'

const copy = value => structuredClone(value)
const recentFirst = (a, b) => String(b.updatedAt || b.createdAt || b.startedAt || '').localeCompare(String(a.updatedAt || a.createdAt || a.startedAt || '')) || String(a.runId || a.sessionId).localeCompare(String(b.runId || b.sessionId))
function notFound(message) { const error = new Error(message); error.code = 'NOT_FOUND'; return error }

/** Stored runs remain readable when execution providers are absent after a restart. */
export function storedExecutions(runtime, app, sessionId) {
  assertApp(app)
  runtime[app].getSession(sessionId) // Do not turn a missing session into an empty success response.
  if (!['agent', 'research'].includes(app)) return []
  return runtime.store.list(`sessions:${app}-execution`).map(row => copy(row.value))
    .filter(run => String(run.sessionId) === String(sessionId)).sort(recentFirst)
}
export function storedExecution(runtime, app, sessionId, runId) {
  assertApp(app); runtime[app].getSession(sessionId)
  const row = ['agent', 'research'].includes(app) ? runtime.store.get(`sessions:${app}-execution`, String(runId)) : null
  if (!row || String(row.value.sessionId) !== String(sessionId)) throw notFound('execution not found')
  return copy(row.value)
}
export function paginate(items, params = {}) {
  const limit = params.limit === undefined || params.limit === null ? 25 : Number(params.limit)
  const offset = params.offset === undefined || params.offset === null ? 0 : Number(params.offset)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer between 1 and 100')
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer')
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset, hasMore: offset + limit < items.length }
}
function executionBrief(run) {
  return { runId: run.runId, sessionId: run.sessionId, status: run.status, startedAt: run.startedAt || run.createdAt, updatedAt: run.updatedAt, error: run.error || null, toolCount: run.toolResults?.length || 0 }
}
function titleFor(app, s) {
  if (app === 'research') return s.question || s.sessionId
  if (app === 'agent') return s.title || s.metadata?.title || s.context?.state?.topic || s.agents?.join(' → ') || s.sessionId
  if (app === 'tutor') return `${s.learnerId || '学习者'} · ${s.currentSkillId || s.state?.learner?.currentSkillId || '技能观察'}`
  if (app === 'life') return s.userId || '个人计划与偏好'
  return s.characterId || '角色关系状态'
}
function domainSummary(app, session, runtime) {
  if (app === 'research') return { kind: app, question: session.question, claimCount: session.context.claims.length, supportCount: session.context.claims.filter(x => x.polarity === 'support').length, opposeCount: session.context.claims.filter(x => x.polarity === 'oppose').length, deliveryCount: session.deliveries.length }
  if (app === 'agent') return { kind: app, contracts: session.agentContracts, contextState: session.context.state, claimCount: session.context.claims.length }
  if (app === 'tutor') return { kind: app, learnerId: session.learnerId, summary: runtime.tutor.getSummary(session.sessionId), state: session.state, snapshotCount: session.snapshots.length, calibration: 'not-qualified' }
  if (app === 'life') return { kind: app, userId: session.userId, state: session.state, realtimeBoundary: 'Only observation locator/audit metadata persists; realtime value is not durable profile memory.' }
  return { kind: app, characterId: session.characterId, state: session.state, snapshotCount: session.snapshots.length }
}
export class ObservatoryReadModel {
  constructor(runtime) { this.runtime = runtime }
  status() {
    const r = this.runtime
    return {
      schema: 'ppl.observatory.status/1', version: OBSERVATORY_VERSION,
      mode: r.executionSummary?.mode === 'fixture' ? 'fixture' : 'local',
      apps: APP_CATALOG,
      execution: { agent: { configured: Boolean(r.agentExecution) }, research: { configured: Boolean(r.researchExecution) } },
      qualification: { externalLiveQualified: false, note: 'Provider configuration is not model qualification. Fixture results are not live model evidence.' },
      boundaries: { singleUserLocalOnly: true, authentication: false, semanticJudgeOverrideInUi: false, credentialRedaction: 'best-effort / not a DLP guarantee' },
    }
  }
  sessions(params = {}) {
    const apps = params.app ? [assertApp(params.app)] : APP_CATALOG.map(x => x.id)
    let items = []
    for (const app of apps) {
      // Product-scale prototype: the existing RecordStore is an in-process list API.
      // Pagination bounds HTTP payloads, not database scan cost; no large-dataset claim.
      const runs = ['agent', 'research'].includes(app) ? this.runtime.store.list(`sessions:${app}-execution`).map(row => row.value).sort(recentFirst) : []
      const latest = new Map()
      for (const run of runs) if (!latest.has(String(run.sessionId))) latest.set(String(run.sessionId), run)
      items.push(...this.runtime[app].listSessions().map(s => {
        const run = latest.get(String(s.sessionId))
        return { app, sessionId: String(s.sessionId), title: String(titleFor(app, s)), status: s.status || 'active', displayStatus: run?.status || s.status || 'active', latestRunId: run?.runId || null, updatedAt: run?.updatedAt && run.updatedAt > s.updatedAt ? run.updatedAt : s.updatedAt }
      }))
    }
    const q = String(params.q || '').trim().toLowerCase()
    if (q) items = items.filter(s => `${s.title} ${s.sessionId} ${s.app}`.toLowerCase().includes(q))
    if (params.status) items = items.filter(s => s.displayStatus === params.status)
    return { schema: 'ppl.observatory.sessions/1', ...redact(paginate(items.sort(recentFirst), params)) }
  }
  detail(app, sessionId) {
    assertApp(app)
    const session = this.runtime[app].getSession(sessionId)
    const runs = storedExecutions(this.runtime, app, sessionId)
    return redact({ schema: 'ppl.observatory.session/1', app, title: titleFor(app, session), session,
      domain: domainSummary(app, session, this.runtime),
      execution: { configured: Boolean(this.runtime[`${app}Execution`]), latest: runs[0] ? executionBrief(runs[0]) : null, count: runs.length },
      displayStatus: runs[0]?.status || session.status || 'active',
      counts: { claims: session.context?.claims?.length || 0, handoffs: session.handoffs?.length || 0, fidelity: session.fidelity?.length || 0, audit: session.audit?.length || 0, executions: runs.length },
    })
  }
  audit(app, sessionId, params = {}) {
    assertApp(app)
    let items = this.runtime[app].getAudit(sessionId).map((e, i) => ({ seq: i + 1, ...e }))
    if (params.type) items = items.filter(e => String(e.type).includes(String(params.type)))
    return { schema: 'ppl.observatory.audit/1', ...redact(paginate(items, params)) }
  }
  executions(app, sessionId, params = {}) {
    return { schema: 'ppl.observatory.executions/1', ...redact(paginate(storedExecutions(this.runtime, app, sessionId).map(executionBrief), params)) }
  }
  execution(app, sessionId, runId) { return redact(storedExecution(this.runtime, app, sessionId, runId)) }
  export(app, sessionId) {
    return { schema: 'ppl.observatory.export/1', exportedAt: new Date().toISOString(), version: OBSERVATORY_VERSION,
      warning: 'Local-owner diagnostic export; still contains business data. Credential redaction is best-effort, not complete anonymization. Not an independently signed audit proof.',
      detail: this.detail(app, sessionId),
      audit: redact(this.runtime[app].getAudit(sessionId)),
      executions: redact(storedExecutions(this.runtime, app, sessionId)),
    }
  }
}
