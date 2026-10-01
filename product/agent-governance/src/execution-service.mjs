import crypto from 'node:crypto'
import { PPL_MAG_CONTEXT_SCHEMA } from '@ppl/multi-agent-governance'
import {
  ExecutionRunRepository, RecordStoreToolExecutionStore, HANDOFF_RECEIVER_RESPONSE_SCHEMA, invokeStructured, invokeWithResilience,
  validateStructuredResult, createOpenAICompatibleChatContinuationRequest, createToolRegistry, ToolExecutionLedger,
} from '@ppl/platform-execution'

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const uid = prefix => `${prefix}_${crypto.randomUUID()}`
const now = () => new Date().toISOString()

export class AgentExecutionService {
  constructor(options = {}) {
    if (!options.governanceService) throw new Error('governanceService required')
    if (!options.modelTransport) throw new Error('modelTransport required')
    this.governanceService = options.governanceService
    this.modelTransport = options.modelTransport
    this.runs = options.executionRepository || new ExecutionRunRepository(options.store || options.governanceService.store, 'agent-execution')
    this.transportOptions = options.transportOptions || {}
    this.toolRegistry = options.toolRegistry || (Array.isArray(options.tools) && options.tools.length ? createToolRegistry(options.tools) : null)
    const ledgerStore = options.toolExecutionStore || (options.store || options.governanceService.store ? new RecordStoreToolExecutionStore(options.store || options.governanceService.store, 'tool-execution:agent') : null)
    this.toolExecutionLedger = options.toolExecutionLedger || new ToolExecutionLedger(ledgerStore ? { store: ledgerStore } : {})
  }

  listRuns() {
    return this.runs.list().map(row => ({ runId: row.id, ...clone(row.value) }))
  }

  getRun(runId) {
    const row = this.runs.get(runId)
    if (!row) throw new Error(`unknown execution run: ${runId}`)
    return clone(row.value)
  }

  async executeHandoff(sessionId, input = {}) {
    const runId = String(input.runId || uid('agent_run'))
    const createdAt = now()
    const run = {
      schema: 'ppl.product.agent-execution-run/1', runId, sessionId: String(sessionId),
      status: 'started', createdAt, updatedAt: createdAt,
      model: clone(this.modelTransport.identity || {}), handoffId: null,
      transport: null, toolResults: [], fidelity: null, message: null, error: null,
    }
    let row = this.runs.create(run)
    try {
      const handoffResult = this.governanceService.createHandoff(sessionId, input)
      if (!handoffResult.allowed) {
        run.status = 'blocked-before-model'
        run.error = { phase: handoffResult.phase, violations: handoffResult.delegationDecision?.violations || handoffResult.projection?.violations || [] }
        run.updatedAt = now(); row = this.runs.save(run, row.revision)
        return clone(row.value)
      }
      const handoff = handoffResult.handoff
      run.handoffId = handoff.handoffId
      const request = {
        schema: 'ppl.product.agent-execution-request/1',
        requestId: uid('agent_request'),
        modelRole: handoff.targetAgentId,
        instructions: [
          'Act only as the target agent in this governed handoff.',
          'The supplied claims are canonical evidence. Preserve every material claim, its polarity, confidence, attribution, provenance and conflict-set membership.',
          'Do not add source facts, upgrade confidence, or erase opposing evidence.',
          'Return only the required JSON object.',
        ],
        authority: clone(handoff.delegationDecisionId),
        handoff: clone(handoff),
        responseContract: { jsonSchema: HANDOFF_RECEIVER_RESPONSE_SCHEMA },
      }
      const requestedTools = Array.isArray(input.requestedTools) ? input.requestedTools.map(String) : []
      let invoked
      if (requestedTools.length) {
        if (!this.toolRegistry) {
          run.status = 'blocked-tool-registry-missing'; run.error = { code: 'TOOL_REGISTRY_MISSING', requestedTools }
          run.updatedAt = now(); row = this.runs.save(run, row.revision); return clone(row.value)
        }
        request.transportTools = this.toolRegistry.list().filter(tool => requestedTools.includes(tool.name))
        request.transportStructuredOutput = false
        const initial = await invokeWithResilience(this.modelTransport, request, { ...this.transportOptions, ...(input.transport || {}), signal: input.signal })
        if (initial.status !== 'completed') {
          run.transport = clone(initial); run.status = 'model-failed'; run.error = { transportStatus: initial.status }
          run.updatedAt = now(); row = this.runs.save(run, row.revision); return clone(row.value)
        }
        if (Array.isArray(initial.toolCalls) && initial.toolCalls.length) {
          const granted = new Set(handoffResult.delegationDecision.granted?.tools || [])
          for (const call of initial.toolCalls) {
            if (!granted.has(String(call.name))) {
              run.transport = clone(initial); run.status = 'blocked-unauthorized-tool'; run.error = { code: 'UNAUTHORIZED_TOOL_CALL', tool: call.name }
              run.updatedAt = now(); row = this.runs.save(run, row.revision); return clone(row.value)
            }
            const originalCallId = String(call.callId || '')
            if (!originalCallId) {
              run.transport = clone(initial); run.status = 'blocked-invalid-tool-call'; run.error = { code: 'TOOL_CALL_ID_REQUIRED', tool: call.name }
              run.updatedAt = now(); row = this.runs.save(run, row.revision); return clone(row.value)
            }
            const ledgerCall = { ...call, callId: `${sessionId}:${handoff.handoffId}:${originalCallId}` }
            const ledgerResult = await this.toolExecutionLedger.execute(this.toolRegistry, ledgerCall, { sessionId, runId, handoffId: handoff.handoffId, providerCallId: originalCallId })
            run.toolResults.push(clone({ ...ledgerResult, ledgerCallId: ledgerResult.callId, callId: originalCallId }))
          }
          const continuation = createOpenAICompatibleChatContinuationRequest(request, initial, run.toolResults, { structuredOutput: true, toolChoice: 'none', parallelToolCalls: false })
          invoked = await invokeStructured(this.modelTransport, continuation, { ...this.transportOptions, ...(input.transport || {}), signal: input.signal, label: 'handoff receiver continuation' })
          run.transport = { initial: clone(initial), continuation: clone(invoked.transport) }
        } else {
          invoked = validateStructuredResult(initial, request, 'handoff receiver')
          run.transport = clone(initial)
        }
      } else {
        invoked = await invokeStructured(this.modelTransport, request, { ...this.transportOptions, ...(input.transport || {}), signal: input.signal, label: 'handoff receiver' })
        run.transport = clone(invoked.transport)
      }
      if (!invoked.ok) {
        run.status = 'model-failed'
        run.error = { parseError: invoked.parseError || null, contractError: invoked.contractError || null, contractIssues: invoked.contractIssues || [], transportStatus: invoked.transport?.status || null }
        run.updatedAt = now(); row = this.runs.save(run, row.revision)
        return clone(row.value)
      }
      const response = invoked.value
      if (response.schema !== 'ppl.product.handoff-receiver-response/1' || !Array.isArray(response.claims)) {
        run.status = 'model-contract-invalid'
        run.error = { code: 'RECEIVER_RESPONSE_INVALID' }
        run.updatedAt = now(); row = this.runs.save(run, row.revision)
        return clone(row.value)
      }
      const receivedContext = { schema: PPL_MAG_CONTEXT_SCHEMA, state: clone(handoff.payload.state), claims: clone(response.claims) }
      const fidelity = this.governanceService.assessHandoff(sessionId, { handoffId: handoff.handoffId, receivedContext, receivedTask: clone(handoff.task), confidenceTolerance: input.confidenceTolerance })
      run.fidelity = clone(fidelity)
      run.message = String(response.message || '')
      run.status = fidelity.hardGatePassed ? 'completed' : 'blocked-by-fidelity'
      run.updatedAt = now(); row = this.runs.save(run, row.revision)
      return clone(row.value)
    } catch (error) {
      run.status = 'failed'
      run.error = { message: error.message, code: error.code || null }
      run.updatedAt = now()
      try { row = this.runs.save(run, row.revision) } catch {}
      throw error
    }
  }
}
