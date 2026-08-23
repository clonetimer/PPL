import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  compileGptHostRequest,
  compileAgentPolicyJudgeRequest,
  decideAgentDelivery,
  applyTutorModelResponse,
  applyResearchModelResponse,
} from './index.mjs'
import {
  invokeWithResilience,
  assertModelIndependence,
  SessionWriteCoordinator,
  SessionLeaseCoordinator,
} from './transport.mjs'
import { ToolExecutionLedger } from './tools.mjs'

export const RECOVERABLE_AGENT_TURN_CHECKPOINT_SCHEMA = 'ppl.recoverable-agent-turn-checkpoint/0.1'
export const RECOVERABLE_AGENT_TURN_RESULT_SCHEMA = 'ppl.recoverable-agent-turn-result/0.1'

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function parseStructuredOutput(result, label) {
  if (result?.status !== 'completed') throw new Error(`${label} transport did not complete: ${result?.status || 'unknown'}`)
  if (result.output && typeof result.output === 'object') return result.output
  const text = String(result.output || '').trim()
  if (!text) throw new Error(`${label} returned empty output`)
  try { return JSON.parse(text) } catch (error) { throw new Error(`${label} returned non-JSON structured output`, { cause: error }) }
}

function mutationForDeliveredAgent(profile, state, request, response, customApply) {
  if (typeof customApply === 'function') return customApply(profile, state, request, response)
  if (profile.kind === 'tutor') return applyTutorModelResponse(profile, state, request, response)
  if (profile.kind === 'research') return applyResearchModelResponse(profile, state, request, response)
  throw new Error(`Unsupported profile kind ${profile.kind}; provide input.applyDeliveredResponse for a custom binding`)
}

function compactTransport(result) {
  if (!result) return null
  return {
    status: result.status,
    output: result.output ?? null,
    toolCalls: result.toolCalls || [],
    usage: result.usage || null,
    providerRequestId: result.providerRequestId || null,
    raw: result.raw || null,
    capabilityAudit: result.capabilityAudit || null,
  }
}

export class MemoryRecoverableTurnStore {
  #entries = new Map()
  async get(turnId) { return this.#entries.get(String(turnId)) || null }
  async set(turnId, checkpoint) { this.#entries.set(String(turnId), structuredClone(checkpoint)) }
  async delete(turnId) { this.#entries.delete(String(turnId)) }
  async size() { return this.#entries.size }
}

export class AppendOnlyJsonlRecoverableTurnStore {
  constructor(filePath) {
    if (!filePath) throw new Error('AppendOnlyJsonlRecoverableTurnStore requires file path')
    this.filePath = path.resolve(filePath)
    this.loaded = false
    this.entries = {}
    this.writeTail = Promise.resolve()
  }

  async #load() {
    if (this.loaded) return
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const lines = raw.split(/\r?\n/).filter(Boolean)
      const entries = {}
      for (let index = 0; index < lines.length; index += 1) {
        let row
        try { row = JSON.parse(lines[index]) } catch (error) {
          throw new Error(`Invalid recoverable-turn JSONL record at line ${index + 1}`, { cause: error })
        }
        const turnId = String(row?.turnId || '')
        if (!turnId) throw new Error(`Recoverable-turn JSONL record at line ${index + 1} is missing turnId`)
        if (row.deleted === true) delete entries[turnId]
        else if (row.checkpoint?.schema === RECOVERABLE_AGENT_TURN_CHECKPOINT_SCHEMA) entries[turnId] = row.checkpoint
        else throw new Error(`Recoverable-turn JSONL record at line ${index + 1} has invalid checkpoint`)
      }
      this.entries = entries
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.entries = {}
    }
    this.loaded = true
  }

  async #append(record) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const handle = await fs.open(this.filePath, 'a')
    try {
      await handle.writeFile(JSON.stringify(record) + '\n', 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async get(turnId) { await this.#load(); return this.entries[String(turnId)] || null }
  async set(turnId, checkpoint) {
    await this.#load()
    const key = String(turnId)
    this.entries[key] = structuredClone(checkpoint)
    this.writeTail = this.writeTail.then(() => this.#append({ turnId: key, checkpoint }))
    await this.writeTail
  }
  async delete(turnId) {
    await this.#load()
    const key = String(turnId)
    delete this.entries[key]
    this.writeTail = this.writeTail.then(() => this.#append({ turnId: key, deleted: true }))
    await this.writeTail
  }
  async size() { await this.#load(); return Object.keys(this.entries).length }
}

function inputIdentity(profile, sessionId, input, registry) {
  return digest({
    profile: { id: profile?.id, version: profile?.version, kind: profile?.kind },
    sessionId,
    turn: input.turn ?? null,
    step: input.step ?? null,
    userMessage: input.userMessage ?? '',
    rubric: input.rubric ?? null,
    allowFinalAnswer: input.allowFinalAnswer ?? null,
    tools: registry?.list?.() || [],
    lifecycleContractId: input.lifecycleContractId || null,
  })
}

export class RecoverableToolMediatedAgentLifecycle {
  constructor(options = {}) {
    if (!options.agentTransport || !options.judgeTransport) throw new Error('agentTransport and judgeTransport are required')
    this.agentTransport = options.agentTransport
    this.judgeTransport = options.judgeTransport
    this.independenceMode = options.independenceMode || 'preferred'
    this.independence = assertModelIndependence(this.agentTransport, this.judgeTransport, this.independenceMode)
    this.toolExecutionLedger = options.toolExecutionLedger || new ToolExecutionLedger()
    this.turnStore = options.turnStore || new MemoryRecoverableTurnStore()
    this.writeCoordinator = options.writeCoordinator || new SessionWriteCoordinator()
    this.sessionLease = options.sessionLease || new SessionLeaseCoordinator()
    this.continuationRequestBuilder = options.continuationRequestBuilder || null
    this.transportDefaults = options.transportDefaults || {}
  }

  async #invoke(transport, request, input, judge = false) {
    return invokeWithResilience(transport, request, {
      ...this.transportDefaults,
      ...(judge ? (input.judgeTransport || {}) : (input.transport || {})),
      signal: input.signal,
    })
  }

  async #checkpoint(current, patch, input) {
    const next = {
      ...(current || {}),
      ...patch,
      schema: RECOVERABLE_AGENT_TURN_CHECKPOINT_SCHEMA,
      revision: Number(current?.revision || 0) + 1,
      updatedAt: new Date().toISOString(),
    }
    await this.turnStore.set(next.turnId, next)
    if (typeof input.lifecycleHook === 'function') await input.lifecycleHook({ phase: next.phase, checkpoint: structuredClone(next) })
    return next
  }

  async #runCore(profile, durableState, input = {}) {
    const sessionId = String(input.sessionId || `${profile.id}:default`)
    const turnId = String(input.turnId || '')
    if (!turnId) throw new Error('runRecoverableToolMediatedAgentTurn requires input.turnId')
    const registry = input.toolRegistry
    if (!registry?.list || !registry?.has) throw new Error('runRecoverableToolMediatedAgentTurn requires input.toolRegistry')
    const continuationBuilder = input.continuationRequestBuilder || this.continuationRequestBuilder
    if (typeof continuationBuilder !== 'function') throw new Error('Recoverable tool lifecycle requires a continuationRequestBuilder')

    const stateDigest = digest(durableState)
    const requestIdentity = inputIdentity(profile, sessionId, input, registry)
    let cp = await this.turnStore.get(turnId)
    const resumed = Boolean(cp)
    const resumeStartPhase = cp?.phase || null
    const resumeHadToolResults = Boolean(resumed && Array.isArray(cp?.toolResults) && cp.toolResults.length > 0)

    if (cp) {
      if (cp.sessionId !== sessionId) return { status: 'blocked', reason: 'turn-session-mismatch', state: durableState, committed: false }
      if (cp.profile?.id !== profile.id || cp.profile?.version !== profile.version) return { status: 'blocked', reason: 'turn-profile-mismatch', state: durableState, committed: false }
      if (cp.stateDigest !== stateDigest) return { status: 'stale-state', reason: 'turn-state-digest-mismatch', state: durableState, committed: false, turnId }
      if (cp.requestIdentity !== requestIdentity) return { status: 'blocked', reason: 'turn-input-mismatch', state: durableState, committed: false, turnId }
      if (cp.phase === 'committed') return { ...cp.result, resumed: true, replayedTurn: true }
      if (cp.phase === 'terminal') return { ...cp.result, resumed: true, replayedTurn: true }
    } else {
      const compileRequest = input.compileRequest || compileGptHostRequest
      let request = compileRequest(profile, durableState, input)
      request = {
        ...request,
        transportStructuredOutput: false,
        transportTools: registry.list(),
        transportParallelToolCalls: false,
      }
      cp = await this.#checkpoint(null, {
        turnId, sessionId,
        profile: { id: profile.id, version: profile.version, kind: profile.kind },
        stateDigest, requestIdentity,
        phase: 'initialized',
        request,
        independence: this.independence,
        createdAt: new Date().toISOString(),
      }, input)
    }

    if (cp.phase === 'initialized') {
      const initial = await this.#invoke(this.agentTransport, cp.request, input, false)
      if (initial.status !== 'completed') {
        return { status: initial.status, reason: 'agent-tool-proposal-transport-failed', state: durableState, committed: false, turnId, resumed, transport: initial }
      }
      const calls = Array.isArray(initial.toolCalls) ? initial.toolCalls : []
      if (calls.length === 0) {
        if (input.requireTool !== false) {
          const result = { schema: RECOVERABLE_AGENT_TURN_RESULT_SCHEMA, status: 'blocked', reason: 'tool-required-but-not-called', state: durableState, committed: false, turnId }
          cp = await this.#checkpoint(cp, { phase: 'terminal', terminalReason: result.reason, result, initialTransport: compactTransport(initial) }, input)
          return { ...result, resumed }
        }
        let agentResponse
        try { agentResponse = parseStructuredOutput(initial, 'agent') } catch {
          const result = { schema: RECOVERABLE_AGENT_TURN_RESULT_SCHEMA, status: 'blocked', reason: 'agent-structured-output-invalid', state: durableState, committed: false, turnId }
          cp = await this.#checkpoint(cp, { phase: 'terminal', terminalReason: result.reason, result, initialTransport: compactTransport(initial) }, input)
          return { ...result, resumed }
        }
        cp = await this.#checkpoint(cp, { phase: 'agent-final', finalTransport: compactTransport(initial), agentResponse }, input)
      } else {
        cp = await this.#checkpoint(cp, { phase: 'agent-tool-proposal', initialTransport: compactTransport(initial), toolCalls: calls }, input)
      }
    }

    if (cp.phase === 'agent-tool-proposal') {
      const toolResults = []
      for (const call of cp.toolCalls || []) toolResults.push(await this.toolExecutionLedger.execute(registry, call, { ...input.toolContext, sessionId, turnId }))
      if (typeof input.lifecycleHook === 'function') await input.lifecycleHook({ phase: 'after-tool-ledger-before-turn-checkpoint', checkpoint: structuredClone(cp), toolResults: structuredClone(toolResults) })
      cp = await this.#checkpoint(cp, { phase: 'tools-executed', toolResults }, input)
    }

    if (cp.phase === 'tools-executed') {
      const continuationRequest = cp.continuationRequest || continuationBuilder(cp.request, cp.initialTransport, cp.toolResults || [], {
        structuredOutput: true,
        toolChoice: 'none',
        parallelToolCalls: false,
      })
      if (!cp.continuationRequest) cp = await this.#checkpoint(cp, { phase: 'continuation-ready', continuationRequest }, input)
    }

    if (cp.phase === 'continuation-ready') {
      const finalTransport = await this.#invoke(this.agentTransport, cp.continuationRequest, input, false)
      if (finalTransport.status !== 'completed') {
        return { status: finalTransport.status, reason: 'agent-continuation-transport-failed', state: durableState, committed: false, turnId, resumed, transport: finalTransport }
      }
      let agentResponse
      try { agentResponse = parseStructuredOutput(finalTransport, 'agent continuation') } catch {
        const result = { schema: RECOVERABLE_AGENT_TURN_RESULT_SCHEMA, status: 'blocked', reason: 'agent-continuation-structured-output-invalid', state: durableState, committed: false, turnId }
        cp = await this.#checkpoint(cp, { phase: 'terminal', terminalReason: result.reason, result, finalTransport: compactTransport(finalTransport) }, input)
        return { ...result, resumed }
      }
      cp = await this.#checkpoint(cp, { phase: 'agent-final', finalTransport: compactTransport(finalTransport), agentResponse }, input)
    }

    if (cp.phase === 'agent-final') {
      const judgeRequest = compileAgentPolicyJudgeRequest(cp.request, cp.agentResponse, {
        rubric: input.rubric,
        allowFinalAnswer: input.allowFinalAnswer,
      })
      const judgeTransport = await this.#invoke(this.judgeTransport, judgeRequest, input, true)
      if (judgeTransport.status !== 'completed') {
        return { status: 'blocked', reason: 'policy-judge-transport-failed', state: durableState, committed: false, turnId, resumed }
      }
      let judgeResponse
      try { judgeResponse = parseStructuredOutput(judgeTransport, 'policy judge') } catch {
        const result = { schema: RECOVERABLE_AGENT_TURN_RESULT_SCHEMA, status: 'blocked', reason: 'policy-judge-structured-output-invalid', state: durableState, committed: false, turnId }
        cp = await this.#checkpoint(cp, { phase: 'terminal', terminalReason: result.reason, result, judgeRequest, judgeTransport: compactTransport(judgeTransport) }, input)
        return { ...result, resumed }
      }
      const delivery = decideAgentDelivery(cp.request, cp.agentResponse, judgeRequest, judgeResponse, input.delivery || {})
      cp = await this.#checkpoint(cp, { phase: 'judged', judgeRequest, judgeResponse, judgeTransport: compactTransport(judgeTransport), delivery }, input)
    }

    if (cp.phase === 'judged') {
      if (cp.delivery?.status !== 'deliver') {
        const result = {
          schema: RECOVERABLE_AGENT_TURN_RESULT_SCHEMA,
          status: cp.delivery?.status || 'blocked',
          reason: cp.delivery?.reason || 'policy-not-deliverable',
          state: durableState,
          committed: false,
          turnId,
          delivery: cp.delivery,
        }
        cp = await this.#checkpoint(cp, { phase: 'terminal', terminalReason: result.reason, result }, input)
        return { ...result, resumed }
      }
      cp = await this.#checkpoint(cp, { phase: 'delivery-approved', deliveryApprovedAt: new Date().toISOString() }, input)
    }

    if (cp.phase === 'delivery-approved') {
      const result = await this.writeCoordinator.runExclusive(sessionId, async () => {
        const applied = mutationForDeliveredAgent(profile, durableState, cp.request, cp.agentResponse, input.applyDeliveredResponse)
        return {
          schema: RECOVERABLE_AGENT_TURN_RESULT_SCHEMA,
          status: 'delivered',
          message: cp.agentResponse.message,
          action: cp.agentResponse.action,
          state: applied.state,
          snapshot: applied.snapshot || null,
          event: applied.event || null,
          delivery: cp.delivery,
          committed: true,
          turnId,
          toolResults: cp.toolResults || [],
          audit: {
            schema: 'ppl.recoverable-agent-turn-audit/0.1',
            resumed,
            independence: this.independence,
            initialProviderRequestId: cp.initialTransport?.providerRequestId || null,
            finalProviderRequestId: cp.finalTransport?.providerRequestId || null,
            judgeProviderRequestId: cp.judgeTransport?.providerRequestId || null,
            toolCalls: (cp.toolCalls || []).map((call, index) => ({ callId: call.callId, name: call.name, replayed: Boolean(cp.toolResults?.[index]?.replayed) })),
            deliveryCommittedAfterJudge: true,
            resumedFromPhase: resumed ? resumeStartPhase : null,
            toolResultsRecoveredFromDurableTurn: resumeHadToolResults,
            toolResultsReplayedFromDurableLedger: resumed && (cp.toolResults || []).some(result => result?.replayed === true),
          },
        }
      })
      cp = await this.#checkpoint(cp, { phase: 'committed', result, committedAt: new Date().toISOString() }, input)
      return { ...result, resumed }
    }

    throw new Error(`Unsupported recoverable turn phase ${cp.phase}`)
  }

  async run(profile, durableState, input = {}) {
    const sessionId = String(input.sessionId || `${profile.id}:default`)
    const lease = await this.sessionLease.tryRunExclusive(sessionId, () => this.#runCore(profile, durableState, input))
    if (!lease.acquired) return { status: 'session-busy', reason: lease.reason, state: durableState, committed: false, turnId: input.turnId || null }
    return lease.value
  }
}

export function createRecoverableToolMediatedAgentLifecycle(options = {}) {
  return new RecoverableToolMediatedAgentLifecycle(options)
}

export async function runRecoverableToolMediatedAgentTurn(lifecycle, profile, durableState, input = {}) {
  if (!lifecycle || typeof lifecycle.run !== 'function') throw new Error('runRecoverableToolMediatedAgentTurn requires a recoverable lifecycle instance')
  return lifecycle.run(profile, durableState, input)
}
