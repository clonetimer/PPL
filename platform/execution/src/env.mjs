import { assertProductEndpoint, createBoundedFetch, boundedInteger, boundaryError } from './http-boundary.mjs'
import { assertExecutionIndependence } from './independence.mjs'
import { createOpenAICompatibleChatTransport } from './transports.mjs'
import { createHttpJsonRetrievalProvider, createSearxngRetrievalProvider } from './retrieval.mjs'

function truthy(value) { return ['1','true','yes','on'].includes(String(value || '').toLowerCase()) }
function required(value, name) { const v=String(value || '').trim(); if(!v) throw boundaryError('EXECUTION_CONFIG_MISSING', `${name} required when PPL execution is enabled`); return v }

export function executionEnvSummary(env = process.env) {
  return {
    enabled: truthy(env.PPL_EXECUTION_ENABLED),
    agentPreset: env.PPL_AGENT_PRESET || 'vllm',
    agentEndpoint: env.PPL_AGENT_ENDPOINT || null,
    agentModel: env.PPL_AGENT_MODEL || null,
    judgePreset: env.PPL_JUDGE_PRESET || env.PPL_AGENT_PRESET || 'vllm',
    judgeEndpoint: env.PPL_JUDGE_ENDPOINT || null,
    judgeModel: env.PPL_JUDGE_MODEL || null,
    retrievalKind: env.PPL_RETRIEVAL_KIND || null,
    retrievalEndpoint: env.PPL_RETRIEVAL_ENDPOINT || null,
    independenceMode: env.PPL_MODEL_INDEPENDENCE || 'preferred',
  }
}

export function createExecutionDependenciesFromEnv(env = process.env) {
  const summary = executionEnvSummary(env)
  if (!summary.enabled) return { enabled:false, summary }
  const allowRemote = truthy(env.PPL_ALLOW_REMOTE_ENDPOINTS)
  const agentEndpoint = required(summary.agentEndpoint, 'PPL_AGENT_ENDPOINT')
  const agentModel = required(summary.agentModel, 'PPL_AGENT_MODEL')
  const judgeEndpoint = required(summary.judgeEndpoint, 'PPL_JUDGE_ENDPOINT')
  const judgeModel = required(summary.judgeModel, 'PPL_JUDGE_MODEL')
  assertProductEndpoint(agentEndpoint, allowRemote)
  assertProductEndpoint(judgeEndpoint, allowRemote)
  const httpTimeoutMs = boundedInteger(env.PPL_HTTP_TIMEOUT_MS, 'PPL_HTTP_TIMEOUT_MS', 30000, 1, 300000)
  const maxResponseBytes = boundedInteger(env.PPL_HTTP_MAX_RESPONSE_BYTES, 'PPL_HTTP_MAX_RESPONSE_BYTES', 2097152, 1, 16777216)
  const maxDocumentChars = boundedInteger(env.PPL_RETRIEVAL_MAX_DOCUMENT_CHARS, 'PPL_RETRIEVAL_MAX_DOCUMENT_CHARS', 50000, 1, 200000)
  const fetchImpl = createBoundedFetch({ timeoutMs:httpTimeoutMs, maxBytes:maxResponseBytes })
  const modelTransport = createOpenAICompatibleChatTransport({
    preset: summary.agentPreset, endpoint: agentEndpoint, model: agentModel,
    apiKey: env.PPL_AGENT_API_KEY || '', allowRemoteEndpoint: allowRemote, fetchImpl,
    independenceGroup: env.PPL_AGENT_INDEPENDENCE_GROUP || `model:${agentModel}`,
  })
  const judgeTransport = createOpenAICompatibleChatTransport({
    preset: summary.judgePreset, endpoint: judgeEndpoint, model: judgeModel,
    apiKey: env.PPL_JUDGE_API_KEY || '', allowRemoteEndpoint: allowRemote, fetchImpl,
    independenceGroup: env.PPL_JUDGE_INDEPENDENCE_GROUP || `model:${judgeModel}`,
  })
  const independence = assertExecutionIndependence(modelTransport, judgeTransport, summary.independenceMode)
  const retrievalLimits = { timeoutMs:httpTimeoutMs, maxBytes:maxResponseBytes, maxDocumentChars }
  let retrievalProvider = null
  if (summary.retrievalKind === 'http') retrievalProvider = createHttpJsonRetrievalProvider({ ...retrievalLimits, endpoint: required(summary.retrievalEndpoint, 'PPL_RETRIEVAL_ENDPOINT'), apiKey: env.PPL_RETRIEVAL_API_KEY || '', allowRemoteEndpoint: allowRemote })
  else if (summary.retrievalKind === 'searxng') retrievalProvider = createSearxngRetrievalProvider({ ...retrievalLimits, endpoint: required(summary.retrievalEndpoint, 'PPL_RETRIEVAL_ENDPOINT'), apiKey: env.PPL_RETRIEVAL_API_KEY || '', allowRemoteEndpoint: allowRemote, language: env.PPL_RETRIEVAL_LANGUAGE || undefined })
  else if (summary.retrievalKind) throw boundaryError('EXECUTION_CONFIG_INVALID', 'Unsupported PPL_RETRIEVAL_KIND')
  summary.httpLimits = { timeoutMs:httpTimeoutMs, maxResponseBytes, maxDocumentChars }
  return { enabled:true, summary, modelTransport, judgeTransport, retrievalProvider, independenceMode:summary.independenceMode, independence, transportOptions:{timeoutMs:httpTimeoutMs,maxAttempts:2} }
}
