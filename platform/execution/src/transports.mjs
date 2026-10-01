import { validateJsonContract } from './json-contract.mjs'
import { createCallbackTransport, invokeWithResilience, transportIdentity, assertModelIndependence } from 'ppl-llm-host-adapter/transport'
import { createToolRegistry, ToolExecutionLedger, MemoryToolExecutionStore, JsonFileToolExecutionStore, AppendOnlyJsonlToolExecutionStore } from 'ppl-llm-host-adapter/tools'
import {
  createOpenAICompatibleChatTransport,
  createOpenAICompatibleChatContinuationRequest,
} from '../../../components/infrastructure/provider-local/src/openai-compatible-chat.mjs'
import { createLmStudioNativeJudgeTransport } from '../../../components/infrastructure/judge-lmstudio-native/src/index.mjs'

export {
  createCallbackTransport,
  invokeWithResilience,
  transportIdentity,
  assertModelIndependence,
  createToolRegistry,
  ToolExecutionLedger,
  MemoryToolExecutionStore,
  JsonFileToolExecutionStore,
  AppendOnlyJsonlToolExecutionStore,
  createOpenAICompatibleChatTransport,
  createOpenAICompatibleChatContinuationRequest,
  createLmStudioNativeJudgeTransport,
}

export function createScriptedTransport(script = [], options = {}) {
  const queue = Array.isArray(script) ? [...script] : []
  const calls = []
  const identity = transportIdentity({
    provider: options.provider || 'scripted',
    model: options.model || 'deterministic-test-double',
    deployment: options.deployment || 'memory',
    independenceGroup: options.independenceGroup || `scripted:${options.model || 'deterministic-test-double'}`,
  })
  return {
    kind: 'scripted', identity, calls,
    async invoke(request, context = {}) {
      calls.push({ request: structuredClone(request), context: { attempt: context.attempt, callId: context.callId } })
      if (!queue.length) throw new Error('scripted transport exhausted')
      const next = queue.shift()
      const value = typeof next === 'function' ? await next(request, context) : next
      if (value?.status) return value
      return { status: 'completed', output: typeof value === 'string' ? value : JSON.stringify(value), toolCalls: [], usage: null, providerRequestId: context.callId || null }
    },
  }
}

export function parseJsonTransportOutput(result, label = 'model') {
  if (!result || result.status !== 'completed') throw new Error(`${label} transport did not complete`)
  const raw = String(result.output || '').trim()
  if (!raw) throw new Error(`${label} returned empty output`)
  try { return JSON.parse(raw) } catch (error) { throw new Error(`${label} returned invalid JSON`, { cause: error }) }
}

export function validateStructuredResult(result, request, label = 'model') {
  if (result.status !== 'completed') return { ok:false, transport:result, value:null }
  if (result.toolCalls?.length) return { ok:false, transport:result, value:null, contractError:'UNEXPECTED_TOOL_CALLS', contractIssues:[] }
  let value
  try { value = parseJsonTransportOutput(result, label) }
  catch (error) { return { ok:false, transport:result, value:null, parseError:error.message } }
  const schema = request?.responseContract?.jsonSchema
  if (schema) {
    const validation = validateJsonContract(value, schema)
    if (!validation.valid) return { ok:false, transport:result, value:null, contractError:'RESPONSE_CONTRACT_INVALID', contractIssues:validation.issues }
  }
  return { ok:true, transport:result, value }
}
export async function invokeStructured(transport, request, options = {}) {
  const result = await invokeWithResilience(transport, request, {
    maxAttempts: options.maxAttempts ?? 2,
    timeoutMs: options.timeoutMs ?? 30000,
    baseBackoffMs: options.baseBackoffMs ?? 100,
    signal: options.signal,
  })
  return validateStructuredResult(result, request, options.label || 'model')
}
