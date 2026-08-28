import {
  compileGptHostRequest,
  validateGptHostResponse,
  compileAgentPolicyJudgeRequest,
  decideAgentDelivery,
  compileRetryRequest,
  compileStructuredRepairRequest,
  applyTutorModelResponse,
  applyResearchModelResponse,
  compileTutorObserverRequest,
  materializeTutorObservationFromObserver,
  applyTutorLearnerAssessment,
  compileResearchEvidenceJudgeRequest,
  materializeResearchEvidenceFromJudge,
  applyResearchHostEvent,
} from './index.mjs'
import { invokeWithResilience, collectStreamWithResilience, assertModelIndependence, SessionWriteCoordinator, SessionLeaseCoordinator } from './transport.mjs'
import { ToolExecutionLedger } from './tools.mjs'
import { createRecoverableToolMediatedAgentLifecycle } from './recoverable-lifecycle.mjs'
import { prepareExperienceRules, evaluatePreJudgeExperienceRules } from '@ppl/experience-rule-evolution'

export const LLM_HOST_AUDIT_SCHEMA = 'ppl.llm-host-audit/0.1'

function parseStructuredOutput(result, label) {
  if (result?.status !== 'completed') throw new Error(`${label} transport did not complete: ${result?.status || 'unknown'}`)
  if (result.output && typeof result.output === 'object') return result.output
  const text = String(result.output || '').trim()
  if (!text) throw new Error(`${label} returned empty output`)
  try { return JSON.parse(text) } catch (error) { throw new Error(`${label} returned non-JSON structured output`, { cause: error }) }
}

function transportCall(transport, request, options = {}) {
  const invokeOptions = { ...(options.transport || {}), signal: options.signal }
  if (options.streaming) return collectStreamWithResilience(transport, request, invokeOptions)
  return invokeWithResilience(transport, request, invokeOptions)
}

function mutationForDeliveredAgent(profile, state, request, response) {
  if (profile.kind === 'tutor') return applyTutorModelResponse(profile, state, request, response)
  if (profile.kind === 'research') return applyResearchModelResponse(profile, state, request, response)
  throw new Error(`Unsupported profile kind ${profile.kind}`)
}

export class PplLlmHostAdapter {
  constructor(options = {}) {
    if (!options.agentTransport || !options.judgeTransport) throw new Error('agentTransport and judgeTransport are required')
    this.agentTransport = options.agentTransport
    this.observerTransport = options.observerTransport || options.judgeTransport
    this.judgeTransport = options.judgeTransport
    this.independenceMode = options.independenceMode || 'preferred'
    this.writeCoordinator = options.writeCoordinator || new SessionWriteCoordinator()
    this.sessionLease = options.sessionLease || new SessionLeaseCoordinator()
    this.transportDefaults = options.transportDefaults || {}
    this.maxPolicyRetries = Math.max(0, Number(options.maxPolicyRetries ?? 1))
    this.maxStructuredOutputRetries = Math.max(0, Number(options.maxStructuredOutputRetries ?? 1))
    this.experienceRules = prepareExperienceRules(options.experienceRules || [], options.experienceRuleMode || 'off')
    this.toolExecutionLedger = options.toolExecutionLedger || new ToolExecutionLedger()
    this.independence = assertModelIndependence(this.agentTransport, this.judgeTransport, this.independenceMode)
    this.recoverableLifecycle = createRecoverableToolMediatedAgentLifecycle({
      agentTransport: this.agentTransport,
      judgeTransport: this.judgeTransport,
      independenceMode: this.independenceMode,
      toolExecutionLedger: this.toolExecutionLedger,
      turnStore: options.turnStore,
      writeCoordinator: this.writeCoordinator,
      sessionLease: this.sessionLease,
      continuationRequestBuilder: options.continuationRequestBuilder,
      transportDefaults: this.transportDefaults,
      maxPolicyRetries: this.maxPolicyRetries,
      maxStructuredOutputRetries: this.maxStructuredOutputRetries,
    })
  }

  async #runAgentTurnCore(profile, durableState, input = {}) {
    const sessionId = input.sessionId || `${profile.id}:default`
    const audit = {
      schema: LLM_HOST_AUDIT_SCHEMA,
      operation: 'agent-turn',
      sessionId,
      profile: { id: profile.id, version: profile.version, kind: profile.kind },
      independence: this.independence,
      attempts: [],
      durableMutation: false,
      experienceRules: { mode: this.experienceRules.mode, ruleIds: this.experienceRules.rules.map(rule => rule.ruleId) },
    }
    let request = compileGptHostRequest(profile, durableState, input)
    let delivered = null

    for (let policyAttempt = 0; policyAttempt <= this.maxPolicyRetries; policyAttempt += 1) {
      let agentTransportResult = null
      let agentResponse = null
      let activeAgentRequest = request
      for (let structuredAttempt = 0; structuredAttempt <= this.maxStructuredOutputRetries; structuredAttempt += 1) {
        agentTransportResult = await transportCall(this.agentTransport, activeAgentRequest, {
          streaming: Boolean(input.streaming), signal: input.signal,
          transport: { ...this.transportDefaults, ...(input.transport || {}) },
        })
        if (agentTransportResult.status !== 'completed') {
          audit.attempts.push({ phase: 'agent', policyAttempt, structuredAttempt, transport: agentTransportResult })
          return { status: agentTransportResult.status, state: durableState, audit, transport: agentTransportResult }
        }
        try {
          agentResponse = parseStructuredOutput(agentTransportResult, 'agent')
          break
        } catch (error) {
          audit.attempts.push({ phase: 'agent-parse', policyAttempt, structuredAttempt, error: error.message, transport: agentTransportResult })
          if (structuredAttempt >= this.maxStructuredOutputRetries) return { status: 'blocked', reason: 'agent-structured-output-invalid', state: durableState, audit }
          activeAgentRequest = compileStructuredRepairRequest(activeAgentRequest, { role: 'agent', attempt: structuredAttempt + 1 })
        }
      }
      request = activeAgentRequest

      // Protocol-level fail-closed optimization: structurally invalid drafts can never
      // be delivered, so do not spend an external Judge call before retrying them.
      const structural = validateGptHostResponse(request, agentResponse)
      if (!structural.valid) {
        const delivery = {
          status: 'blocked', reason: 'pre-judge-structural-contract-violation', confidence: 1,
          violations: structural.errors.map(detail => ({ code: 'STRUCTURAL', severity: 'error', detail })),
        }
        audit.attempts.push({ phase: 'pre-judge-structural', policyAttempt, requestId: request.requestId, delivery, agentTransport: agentTransportResult, judgeTransport: null })
        if (policyAttempt >= this.maxPolicyRetries) return { status: delivery.status, reason: delivery.reason, state: durableState, audit, delivery }
        request = compileRetryRequest(request, delivery, { attempt: policyAttempt + 1, previousResponse: agentResponse })
        continue
      }

      let judgeRequest = compileAgentPolicyJudgeRequest(request, agentResponse, {
        rubric: input.rubric,
        allowFinalAnswer: input.allowFinalAnswer,
      })
      const experienceRuleDecision = evaluatePreJudgeExperienceRules(this.experienceRules, judgeRequest)
      if (this.experienceRules.mode !== 'off' && this.experienceRules.rules.length > 0) {
        audit.attempts.push({
          phase: 'experience-rule-evaluation', policyAttempt, requestId: request.requestId,
          mode: experienceRuleDecision.mode, matches: experienceRuleDecision.matches,
          matched: experienceRuleDecision.matched, enforced: experienceRuleDecision.enforced,
          skipJudge: experienceRuleDecision.skipJudge,
        })
      }
      if (experienceRuleDecision.skipJudge) {
        const delivery = {
          status: 'blocked', reason: 'experience-rule-pre-judge-fast-path', confidence: 1,
          violations: experienceRuleDecision.violations,
          experienceRuleIds: experienceRuleDecision.matches.map(match => match.ruleId),
        }
        audit.attempts.push({ phase: 'experience-rule-fast-path', policyAttempt, requestId: request.requestId, delivery, agentTransport: agentTransportResult, judgeTransport: null })
        if (policyAttempt >= this.maxPolicyRetries) return { status: delivery.status, reason: delivery.reason, state: durableState, audit, delivery }
        request = compileRetryRequest(request, delivery, { attempt: policyAttempt + 1, previousResponse: agentResponse })
        continue
      }
      let judgeTransportResult = null
      let judgeResponse = null
      let activeJudgeRequest = judgeRequest
      for (let structuredAttempt = 0; structuredAttempt <= this.maxStructuredOutputRetries; structuredAttempt += 1) {
        judgeTransportResult = await transportCall(this.judgeTransport, activeJudgeRequest, {
          streaming: false, signal: input.signal,
          transport: { ...this.transportDefaults, ...(input.judgeTransport || {}) },
        })
        if (judgeTransportResult.status !== 'completed') {
          audit.attempts.push({ phase: 'judge', policyAttempt, structuredAttempt, transport: judgeTransportResult })
          return { status: 'blocked', reason: 'policy-judge-transport-failed', state: durableState, audit }
        }
        try {
          judgeResponse = parseStructuredOutput(judgeTransportResult, 'policy judge')
          break
        } catch (error) {
          audit.attempts.push({ phase: 'judge-parse', policyAttempt, structuredAttempt, error: error.message, transport: judgeTransportResult })
          if (structuredAttempt >= this.maxStructuredOutputRetries) return { status: 'blocked', reason: 'policy-judge-structured-output-invalid', state: durableState, audit }
          activeJudgeRequest = compileStructuredRepairRequest(activeJudgeRequest, { role: 'judge', attempt: structuredAttempt + 1 })
        }
      }
      judgeRequest = activeJudgeRequest
      const delivery = decideAgentDelivery(request, agentResponse, judgeRequest, judgeResponse, input.delivery || {})
      audit.attempts.push({ phase: 'delivery', policyAttempt, requestId: request.requestId, delivery, agentTransport: agentTransportResult, judgeTransport: judgeTransportResult })
      if (delivery.status === 'deliver') {
        delivered = { request, agentResponse, judgeRequest, judgeResponse, delivery }
        break
      }
      if (policyAttempt >= this.maxPolicyRetries) return { status: delivery.status, reason: delivery.reason, state: durableState, audit, delivery }
      request = compileRetryRequest(request, delivery, { attempt: policyAttempt + 1, previousResponse: agentResponse })
    }

    if (!delivered) return { status: 'blocked', reason: 'no-deliverable-draft', state: durableState, audit }
    return this.writeCoordinator.runExclusive(sessionId, async () => {
      const applied = mutationForDeliveredAgent(profile, durableState, delivered.request, delivered.agentResponse)
      audit.durableMutation = Boolean(applied?.snapshot)
      audit.commit = applied?.snapshot?.transaction || { status: applied?.finalized?.status || 'no-state-mutation' }
      return {
        status: 'delivered',
        message: delivered.agentResponse.message,
        action: delivered.agentResponse.action,
        state: applied.state,
        snapshot: applied.snapshot || null,
        event: applied.event || null,
        delivery: delivered.delivery,
        audit,
      }
    })
  }


  async runAgentTurn(profile, durableState, input = {}) {
    const sessionId = input.sessionId || `${profile.id}:default`
    const lease = await this.sessionLease.tryRunExclusive(sessionId, () => this.#runAgentTurnCore(profile, durableState, input))
    if (!lease.acquired) return { status: 'session-busy', reason: lease.reason, state: durableState, committed: false }
    return lease.value
  }

  async #observeTutorCore(profile, durableState, input = {}) {
    const sessionId = input.sessionId || `${profile.id}:default`
    const request = compileTutorObserverRequest(profile, durableState, input)
    const transportResult = await transportCall(this.observerTransport, request, {
      streaming: false, signal: input.signal,
      transport: { ...this.transportDefaults, ...(input.transport || {}) },
    })
    if (transportResult.status !== 'completed') return { status: transportResult.status, state: durableState, transport: transportResult, committed: false }
    const response = parseStructuredOutput(transportResult, 'tutor observer')
    const materialized = materializeTutorObservationFromObserver(request, response, input.materialize || {})
    if (!materialized.accepted) return { status: 'not-accepted', reason: materialized.reason, state: durableState, observer: response, committed: false }
    if (input.commit === false) return { status: 'candidate', assessment: materialized.assessment, state: durableState, observer: response, committed: false }
    return this.writeCoordinator.runExclusive(sessionId, async () => {
      const applied = applyTutorLearnerAssessment(profile, durableState, materialized.assessment, input.host || {})
      return { status: 'committed', assessment: materialized.assessment, state: applied.state, snapshot: applied.snapshot, observer: response, committed: true }
    })
  }


  async observeTutor(profile, durableState, input = {}) {
    const sessionId = input.sessionId || `${profile.id}:default`
    const lease = await this.sessionLease.tryRunExclusive(sessionId, () => this.#observeTutorCore(profile, durableState, input))
    if (!lease.acquired) return { status: 'session-busy', reason: lease.reason, state: durableState, committed: false }
    return lease.value
  }

  async #judgeResearchEvidenceCore(profile, durableState, input = {}) {
    const sessionId = input.sessionId || `${profile.id}:default`
    const request = compileResearchEvidenceJudgeRequest(profile, durableState, input)
    const transportResult = await transportCall(this.observerTransport, request, {
      streaming: false, signal: input.signal,
      transport: { ...this.transportDefaults, ...(input.transport || {}) },
    })
    if (transportResult.status !== 'completed') return { status: transportResult.status, state: durableState, transport: transportResult, committed: false }
    const response = parseStructuredOutput(transportResult, 'research evidence judge')
    const materialized = materializeResearchEvidenceFromJudge(request, response, input.materialize || {})
    if (!materialized.accepted) return { status: 'not-accepted', reason: materialized.reason, state: durableState, judge: response, committed: false }
    if (input.commit === false) return { status: 'candidate', event: materialized.event, state: durableState, judge: response, committed: false }
    return this.writeCoordinator.runExclusive(sessionId, async () => {
      const applied = applyResearchHostEvent(profile, durableState, materialized.event, input.host || {}, input.endReason || 'completed')
      return { status: 'committed', event: materialized.event, state: applied.state, snapshot: applied.snapshot, judge: response, committed: true }
    })
  }


  async judgeResearchEvidence(profile, durableState, input = {}) {
    const sessionId = input.sessionId || `${profile.id}:default`
    const lease = await this.sessionLease.tryRunExclusive(sessionId, () => this.#judgeResearchEvidenceCore(profile, durableState, input))
    if (!lease.acquired) return { status: 'session-busy', reason: lease.reason, state: durableState, committed: false }
    return lease.value
  }

  async executeToolCalls(registry, transportResult, context = {}) {
    const calls = Array.isArray(transportResult?.toolCalls) ? transportResult.toolCalls : []
    const results = []
    for (const call of calls) results.push(await this.toolExecutionLedger.execute(registry, call, context))
    return results
  }

  async runRecoverableToolMediatedAgentTurn(profile, durableState, input = {}) {
    return this.recoverableLifecycle.run(profile, durableState, input)
  }
}

export function createPplLlmHostAdapter(options = {}) {
  return new PplLlmHostAdapter(options)
}
