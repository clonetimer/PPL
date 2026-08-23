#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createOpenAICompatibleChatTransport, createOpenAICompatibleChatContinuationRequest } from '../src/openai-compatible-chat.mjs'
import { localProviderPreset } from '../src/capabilities.mjs'
import { discoverVisibleModels, resolveVisibleModel } from '../src/discovery.mjs'
import { invokeWithResilience, collectStreamWithResilience } from 'ppl-llm-host-adapter/transport'

function arg(name, fallback = null) { const p = process.argv.find(x => x.startsWith(`--${name}=`)); return p ? p.slice(name.length + 3) : fallback }
const preset = arg('preset', process.env.PPL_LOCAL_PRESET || 'lmstudio')
const explicitModel = arg('model', process.env.PPL_LOCAL_MODEL || '')
const modelHint = arg('model-hint', process.env.PPL_LOCAL_MODEL_HINT || 'Qwen3.5-0.8B')
const endpoint = arg('endpoint', process.env.PPL_LOCAL_ENDPOINT || '') || undefined
const apiKey = arg('api-key', process.env.PPL_LOCAL_API_KEY || process.env.LM_API_TOKEN || '') || undefined
const outPath = path.resolve(arg('out', process.env.PPL_LOCAL_CERT_OUT || 'validation/LIVE_LOCAL_PROVIDER_CERT.json'))

function writeAndExit(result, code) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  process.exit(code)
}

let model = explicitModel
let discovery = null
try {
  const presetConfig = localProviderPreset(preset, { ...(endpoint ? { endpoint } : {}) })
  discovery = await discoverVisibleModels({ endpoint: presetConfig.endpoint, apiKey })
  const resolution = resolveVisibleModel(discovery.modelIds, { model: explicitModel, hint: explicitModel ? '' : modelHint })
  if (resolution.status !== 'selected') {
    writeAndExit({ schema: 'ppl.local-provider-live-cert/0.2', generatedAt: new Date().toISOString(), status: 'not-run', passed: false, failureClass: 'environment/model-selection', reason: resolution.status, preset, endpoint: presetConfig.endpoint, modelHint, discovery: { modelsEndpoint: discovery.modelsEndpoint, modelIds: discovery.modelIds, resolution } }, 2)
  }
  model = resolution.selectedModel
  discovery = { modelsEndpoint: discovery.modelsEndpoint, modelIds: discovery.modelIds, resolution }
} catch (error) {
  writeAndExit({ schema: 'ppl.local-provider-live-cert/0.2', generatedAt: new Date().toISOString(), status: 'not-run', passed: false, failureClass: 'environment/server-unreachable', reason: error.message, preset, endpoint: endpoint || null, modelHint }, 3)
}

const transport = createOpenAICompatibleChatTransport({ preset, model, ...(endpoint ? { endpoint } : {}), ...(apiKey ? { apiKey } : {}) })
const schema = {
  type: 'object', additionalProperties: false, required: ['schema','message','value'],
  properties: { schema: { type: 'string', enum: ['ppl.local-cert-response/0.1'] }, message: { type: 'string' }, value: { type: 'integer' } },
}
const baseRequest = {
  schema: 'ppl.local-cert-request/0.1', modelRole: 'local-cert', userMessage: 'Return a JSON acknowledgement with value 7.', authority: { modelMay: ['reply'], modelMustNot: ['invent-tool-output'] },
  responseContract: { jsonSchema: schema }, instructions: ['Use value=7.'],
}
const cases = []
function add(id, passed, failureClass, details = {}) { cases.push({ id, passed, ...(passed ? {} : { failureClass }), ...details }) }

try {
  try {
    const basic = await invokeWithResilience(transport, baseRequest, { maxAttempts: 2, timeoutMs: 90000 })
    let parsed = null; try { parsed = JSON.parse(basic.output || '') } catch {}
    const passed = basic.status === 'completed' && parsed?.schema === 'ppl.local-cert-response/0.1' && parsed?.value === 7
    add('structured-invoke', passed, 'model-or-server-structured-output', { status: basic.status, providerRequestId: basic.providerRequestId, output: basic.output })
  } catch (error) { add('structured-invoke', false, error?.status ? 'server-capability/http' : 'transport/runtime', { error: error.message }) }

  try {
    const streamed = await collectStreamWithResilience(transport, baseRequest, { maxAttempts: 1, timeoutMs: 90000 })
    let streamedParsed = null; try { streamedParsed = JSON.parse(streamed.output || '') } catch {}
    const passed = streamed.status === 'completed' && streamedParsed?.schema === 'ppl.local-cert-response/0.1' && streamedParsed?.value === 7 && streamed.streamAudit?.partialsCommittedToProfile === false
    add('structured-stream', passed, 'model-or-server-structured-stream', { status: streamed.status, providerRequestId: streamed.providerRequestId, output: streamed.output, streamAudit: streamed.streamAudit })
  } catch (error) { add('structured-stream', false, error?.status ? 'server-capability/http' : 'transport/runtime', { error: error.message }) }

  const toolReq = {
    ...baseRequest,
    userMessage: 'You MUST call get_magic_number exactly once before answering. Do not guess or invent the number.',
    instructions: ['Call get_magic_number before the final response.', 'Do not fabricate the tool result.'],
    transportStructuredOutput: false,
    transportTools: [{ name: 'get_magic_number', description: 'Return the Host-owned magic number. This is the only authoritative source for the number.', strict: true, parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] } }],
    ...(transport.capabilities.toolChoiceControl ? { transportToolChoice: { type: 'function', name: 'get_magic_number' } } : {}),
    ...(transport.capabilities.parallelToolCallsControl ? { transportParallelToolCalls: false } : {}),
  }
  try {
    const first = await invokeWithResilience(transport, toolReq, { maxAttempts: 1, timeoutMs: 90000 })
    const call = first.toolCalls?.[0]
    let toolPassed = Boolean(call && call.name === 'get_magic_number')
    let continuation = null
    let finalJson = null
    if (toolPassed) {
      const toolResult = { schema: 'ppl.llm-tool-result/0.1', callId: call.callId, name: call.name, arguments: call.arguments || {}, output: { value: 7 }, provenance: { kind: 'host-tool', hostOwned: true, digest: 'sha256:local-cert-fixed' } }
      const nextReq = createOpenAICompatibleChatContinuationRequest(toolReq, first, [toolResult], { structuredOutput: true })
      continuation = await invokeWithResilience(transport, nextReq, { maxAttempts: 1, timeoutMs: 90000 })
      try { finalJson = JSON.parse(continuation.output || '') } catch {}
      toolPassed = continuation.status === 'completed' && finalJson?.schema === 'ppl.local-cert-response/0.1' && finalJson?.value === 7
    }
    add('tool-call-continuation', toolPassed, call ? 'model-or-server-parser/tool-continuation' : 'model-or-server-parser/tool-call', { initialStatus: first.status, initialOutput: first.output || null, toolCalls: first.toolCalls || [], continuationStatus: continuation?.status || null, output: continuation?.output || null })
  } catch (error) { add('tool-call-continuation', false, error?.status ? 'server-capability/http' : 'transport/runtime', { error: error.message }) }
} catch (error) {
  add('unexpected-cert-exception', false, 'ppl-cert-harness', { error: error.message, stack: error.stack })
}

const passed = cases.every(x => x.passed)
const result = {
  schema: 'ppl.local-provider-live-cert/0.2',
  generatedAt: new Date().toISOString(),
  status: passed ? 'pass' : 'fail', passed,
  transport: { preset, model, modelHint, endpoint: transport.config.endpoint, identity: transport.identity, capabilities: transport.capabilities },
  discovery,
  cases,
  interpretation: {
    realLocalProviderGatePassed: passed,
    promotionReviewEligible: passed,
    note: 'Failures classified as model-or-server-* do not by themselves prove a PPL transport defect. Inspect the raw evidence and LM Studio/model behavior before changing Stable layers.',
    qwenSmallModelCaution: 'Sub-7B structured/tool behavior is an empirical model/server-parser gate; retain the evidence rather than weakening Host contracts to force a pass.',
  },
  meaning: 'Real local inference Provider evidence. This does not certify OpenAI Responses API.',
}
writeAndExit(result, passed ? 0 : 1)
