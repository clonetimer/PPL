import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createOpenAIResponsesTransport,
  createOpenAIResponsesContinuationRequest,
  invokeWithResilience,
  collectStreamWithResilience,
  createPplLlmHostAdapter,
  createToolRegistry,
  ToolExecutionLedger,
  JsonFileToolExecutionStore,
  compileGptHostRequest,
  createTranscript,
  appendTranscriptStep,
  transcriptToAppSession,
  GPT_HOST_RESPONSE_SCHEMA,
} from '../src/main.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = new Set(process.argv.slice(2))
const phaseArg = process.argv.find(x => x.startsWith('--phase='))
const phase = phaseArg ? phaseArg.split('=', 2)[1] : 'all'
const reset = args.has('--reset')
const outDir = process.env.PPL_OPENAI_CERT_DIR
  ? resolve(process.env.PPL_OPENAI_CERT_DIR)
  : resolve(root, 'validation/live-openai')
const model = process.env.PPL_OPENAI_MODEL || 'gpt-5.6'
const apiKeyPresent = Boolean(process.env.OPENAI_API_KEY)
const tutor = JSON.parse(await readFile(resolve(root, 'profiles/tutor.profile.json'), 'utf8'))
await mkdir(outDir, { recursive: true })

const resultPath = resolve(outDir, `LIVE_OPENAI_${phase.toUpperCase().replaceAll('-', '_')}.json`)
const checkpointPath = resolve(outDir, 'TOOL_RECOVERY_CHECKPOINT.json')
const ledgerPath = resolve(outDir, 'tool-execution-ledger.json')
const sideEffectPath = resolve(outDir, 'tool-side-effect.json')
const appSessionPath = resolve(outDir, 'tutor-live-openai.app-session.json')

function safeTransportSummary(result) {
  return {
    status: result?.status || null,
    callId: result?.callId || null,
    providerRequestId: result?.providerRequestId || null,
    attempts: (result?.attempts || []).map(x => ({
      attempt: x.attempt, status: x.status, durationMs: x.durationMs,
      providerRequestId: x.providerRequestId || null,
      error: x.error ? { code: x.error.code, status: x.error.status, retryable: x.error.retryable } : undefined,
    })),
    usage: result?.usage || null,
    toolCalls: (result?.toolCalls || []).map(x => ({ callId: x.callId, name: x.name, arguments: x.arguments })),
  }
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function parseHostOutput(result, label) {
  if (result?.status !== 'completed') throw new Error(`${label} transport status=${result?.status}`)
  const value = typeof result.output === 'object' ? result.output : JSON.parse(String(result.output || ''))
  if (value?.schema !== GPT_HOST_RESPONSE_SCHEMA) throw new Error(`${label} wrong schema ${value?.schema || '<missing>'}`)
  return value
}

function transport() {
  return createOpenAIResponsesTransport({
    model,
    apiKey: process.env.OPENAI_API_KEY,
    project: process.env.OPENAI_PROJECT,
    organization: process.env.OPENAI_ORGANIZATION,
    deployment: process.env.PPL_OPENAI_DEPLOYMENT || null,
    independenceGroup: process.env.PPL_OPENAI_INDEPENDENCE_GROUP || `openai:${model}`,
    maxOutputTokens: Number(process.env.PPL_OPENAI_MAX_OUTPUT_TOKENS || 1200),
    reasoningEffort: process.env.PPL_OPENAI_REASONING_EFFORT || 'low',
  })
}

function baseTutorRequest(id, message = '2/3 + 1/5 怎么做？只给我一个最小提示，不要直接给最终答案。') {
  return compileGptHostRequest(tutor, structuredClone(tutor.initialState), {
    requestId: id, turn: 1, step: 1, userMessage: message,
  })
}

async function structuredGate() {
  const request = baseTutorRequest('live-openai:structured')
  const tr = await invokeWithResilience(transport(), request, { maxAttempts: 2, timeoutMs: 90000 })
  const parsed = parseHostOutput(tr, 'structured')
  return { passed: true, transport: safeTransportSummary(tr), outputSchema: parsed.schema, actionKind: parsed.action?.kind }
}

async function streamingGate() {
  const request = baseTutorRequest('live-openai:stream', '7/8 - 1/6 怎么做？只提示第一步，不要给最终答案。')
  const tr = await collectStreamWithResilience(transport(), request, { maxAttempts: 2, timeoutMs: 90000 })
  const parsed = parseHostOutput(tr, 'stream')
  return {
    passed: tr.streamAudit?.partialsCommittedToProfile === false,
    transport: safeTransportSummary(tr),
    outputSchema: parsed.schema,
    partialsCommittedToProfile: tr.streamAudit?.partialsCommittedToProfile,
  }
}

async function abortGate() {
  const request = baseTutorRequest('live-openai:timeout', '给我一个很短的分数加法提示。')
  const tr = await invokeWithResilience(transport(), request, { maxAttempts: 1, timeoutMs: 1 })
  return {
    passed: tr.status !== 'completed',
    expected: 'real request path is aborted/timed out before completion',
    transport: safeTransportSummary(tr),
  }
}

async function deliveryGate() {
  const base = transport()
  let faultInjected = false
  const faultInjectingAgent = {
    ...base,
    identity: base.identity,
    async invoke(request, context) {
      const live = await base.invoke(request, context)
      if (!request.retry && live?.status === 'completed' && typeof live.output === 'string') {
        const parsed = JSON.parse(live.output)
        parsed.message = `${parsed.message || ''} [CERT_FAULT_INJECTION final answer: 13/15]`
        faultInjected = true
        return { ...live, output: JSON.stringify(parsed) }
      }
      return live
    },
  }
  const host = createPplLlmHostAdapter({
    agentTransport: faultInjectingAgent,
    judgeTransport: base,
    independenceMode: 'preferred',
    maxPolicyRetries: 1,
    transportDefaults: { maxAttempts: 2, timeoutMs: 90000 },
  })
  const initial = structuredClone(tutor.initialState)
  const initialInterventions = initial?.pedagogy?.interventions?.length || 0
  const run = await host.runAgentTurn(tutor, initial, {
    sessionId: 'live-openai:tutor-delivery',
    turn: 1,
    userMessage: '2/3 + 1/5 怎么做？只给提示，不要直接给答案。',
    rubric: { expectedAnswer: '13/15' },
    allowFinalAnswer: false,
  })
  const deliveryRows = (run.audit?.attempts || []).filter(x => x.phase === 'delivery')
  const finalInterventions = run.state?.pedagogy?.interventions?.length || 0
  const passed = faultInjected
    && run.status === 'delivered'
    && deliveryRows.length === 2
    && deliveryRows[0]?.delivery?.status === 'blocked'
    && deliveryRows[1]?.delivery?.status === 'deliver'
    && finalInterventions === initialInterventions + 1
  const transcript = createTranscript(tutor, initial, {
    provider: 'openai', model, transport: 'responses-api', independenceGroup: base.identity.independenceGroup,
  })
  if (run.snapshot) appendTranscriptStep(transcript, { phase: 'live-openai-delivery', snapshot: run.snapshot, event: run.event, state: run.state })
  const appSession = transcriptToAppSession(tutor, transcript, 'Tutor · OpenAI Responses live certification', { host: 'ppl-llm-host-adapter' })
  await writeJson(appSessionPath, appSession)
  return {
    passed,
    faultInjected,
    status: run.status,
    firstCandidateBlocked: deliveryRows[0]?.delivery?.status === 'blocked',
    retryDelivered: deliveryRows[1]?.delivery?.status === 'deliver',
    committedInterventions: finalInterventions - initialInterventions,
    independence: run.audit?.independence || host.independence,
    appSessionPath,
  }
}

async function observatoryGate() {
  const appSession = JSON.parse(await readFile(appSessionPath, 'utf8'))
  const observatoryRoot = process.env.PPL_OBSERVATORY_ROOT
  if (!observatoryRoot) {
    return { passed: null, status: 'not-run', reason: 'PPL_OBSERVATORY_ROOT not set', appSessionPath }
  }
  const modulePath = resolve(observatoryRoot, 'packages/app-core/src/index.mjs')
  const { validateSession, normalizeSession } = await import(pathToFileURL(modulePath).href)
  const errors = validateSession(appSession)
  const normalized = normalizeSession(appSession)
  return {
    passed: errors.length === 0,
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    entries: normalized.entries.length,
    resolverRerun: false,
    appSessionPath,
    appCoreModule: modulePath,
  }
}

async function readSideEffect() {
  try { return JSON.parse(await readFile(sideEffectPath, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return { count: 0 }; throw error }
}

async function makeToolRegistry() {
  return createToolRegistry([{
    name: 'host_counter',
    description: 'Increment the certification counter exactly by delta and return the new count.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['delta'],
      properties: { delta: { type: 'integer' } },
    },
    provenance: 'ppl-live-certification-host-tool',
    execute: async ({ delta }) => {
      const current = await readSideEffect()
      const next = { count: Number(current.count || 0) + delta, executedAt: new Date().toISOString() }
      await writeJson(sideEffectPath, next)
      return next
    },
  }])
}

async function toolCrashPhase() {
  if (reset) {
    await rm(checkpointPath, { force: true })
    await rm(ledgerPath, { force: true })
    await rm(sideEffectPath, { force: true })
  }
  try {
    await readFile(checkpointPath, 'utf8')
    throw new Error('Tool recovery checkpoint already exists; use --reset to start a fresh crash phase')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const registry = await makeToolRegistry()
  const request = {
    ...baseTutorRequest('live-openai:tool', '调用 host_counter，把 delta 设为 1。拿到工具结果后，用一句简短中文告诉我计数结果。'),
    transportTools: registry.list(),
    transportToolChoice: { type: 'function', name: 'host_counter' },
    transportParallelToolCalls: false,
  }
  const first = await invokeWithResilience(transport(), request, { maxAttempts: 2, timeoutMs: 90000 })
  if (first.status !== 'completed' || first.toolCalls?.length !== 1) throw new Error(`Expected exactly one live tool call, got status=${first.status} calls=${first.toolCalls?.length || 0}`)
  const ledger = new ToolExecutionLedger({ store: new JsonFileToolExecutionStore(ledgerPath) })
  const toolResult = await ledger.execute(registry, first.toolCalls[0], { certification: true })
  const side = await readSideEffect()
  const checkpoint = {
    schema: 'ppl.openai-tool-recovery-checkpoint/0.1',
    createdAt: new Date().toISOString(), model,
    request,
    firstTransport: {
      status: first.status,
      callId: first.callId,
      providerRequestId: first.providerRequestId,
      toolCalls: first.toolCalls,
      raw: first.raw,
    },
    toolResult,
    sideEffectCount: side.count,
    lifecyclePoint: 'after-host-side-effect-before-final-model-completion',
  }
  await writeJson(checkpointPath, checkpoint)
  return {
    passed: side.count === 1 && toolResult.replayed === false,
    status: 'checkpointed-before-continuation',
    checkpointPath, ledgerPath, sideEffectPath,
    sideEffectCount: side.count,
    toolCall: first.toolCalls[0],
    providerRequestId: first.providerRequestId,
    next: 'terminate process, then run --phase=tool-resume',
  }
}

async function toolResumePhase() {
  const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'))
  const registry = await makeToolRegistry()
  const ledger = new ToolExecutionLedger({ store: new JsonFileToolExecutionStore(ledgerPath) })
  const first = checkpoint.firstTransport
  const replay = await ledger.execute(registry, first.toolCalls[0], { certification: true, resumed: true })
  const beforeContinuation = await readSideEffect()
  const continuationRequest = createOpenAIResponsesContinuationRequest(checkpoint.request, first, [replay], { toolChoice: 'none', parallelToolCalls: false })
  const continuation = await invokeWithResilience(transport(), continuationRequest, { maxAttempts: 2, timeoutMs: 90000 })
  const finalOutput = parseHostOutput(continuation, 'tool continuation')
  const afterContinuation = await readSideEffect()
  return {
    passed: replay.replayed === true && beforeContinuation.count === 1 && afterContinuation.count === 1 && continuation.status === 'completed',
    status: 'resumed-and-completed',
    replayed: replay.replayed,
    sideEffectCountBeforeContinuation: beforeContinuation.count,
    sideEffectCountAfterContinuation: afterContinuation.count,
    continuation: safeTransportSummary(continuation),
    finalOutputSchema: finalOutput.schema,
    finalMessage: finalOutput.message,
    durableIdempotencyAcrossProcessRestart: true,
  }
}

async function runAll() {
  const startedAt = new Date().toISOString()
  const structured = await structuredGate()
  const streaming = await streamingGate()
  const abort = await abortGate()
  const delivery = await deliveryGate()
  const observatory = await observatoryGate()
  const passed = Boolean(structured.passed && streaming.passed && abort.passed && delivery.passed && observatory.passed === true)
  return {
    schema: 'ppl.openai-live-certification/0.1',
    executedAt: startedAt,
    provider: 'OpenAI Responses API', model,
    apiKeyPresent: true,
    credentialLogged: false,
    status: passed ? 'provisional-live-pass' : 'live-gates-incomplete',
    gates: { structured, streaming, abort, delivery, observatory },
    fullStableCertificationRequires: [
      'run --phase=tool-crash in one process',
      'then run --phase=tool-resume in a new process',
      'validate the generated live app-session through Observatory 0.4 exact app-core',
      'run a genuinely independent Agent/Judge provider with independenceMode=required',
    ],
    passed,
  }
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: String(error?.message || error),
    code: error?.code || null,
    status: error?.status || null,
    retryable: error?.retryable === true,
  }
}

let report
try {
  if (!apiKeyPresent) {
    report = {
      schema: 'ppl.openai-live-certification/0.1',
      executedAt: new Date().toISOString(), provider: 'OpenAI Responses API', model,
      apiKeyPresent: false, credentialLogged: false,
      status: 'not-run', reason: 'OPENAI_API_KEY is not set in this process', passed: false,
    }
  } else if (phase === 'all') report = await runAll()
  else if (phase === 'tool-crash') report = { schema: 'ppl.openai-live-tool-recovery/0.1', phase, executedAt: new Date().toISOString(), model, ...(await toolCrashPhase()) }
  else if (phase === 'tool-resume') report = { schema: 'ppl.openai-live-tool-recovery/0.1', phase, executedAt: new Date().toISOString(), model, ...(await toolResumePhase()) }
  else throw new Error(`Unsupported --phase=${phase}`)
} catch (error) {
  report = {
    schema: phase === 'all' ? 'ppl.openai-live-certification/0.1' : 'ppl.openai-live-tool-recovery/0.1',
    phase,
    executedAt: new Date().toISOString(),
    provider: 'OpenAI Responses API', model,
    apiKeyPresent,
    credentialLogged: false,
    status: 'failed',
    error: safeError(error),
    passed: false,
  }
}

await writeJson(resultPath, report)
console.log(JSON.stringify(report, null, 2))
if (apiKeyPresent && report.passed === false) process.exitCode = 1
