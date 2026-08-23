export const PPL_PROVIDER_CAPABILITIES_SCHEMA = 'ppl.llm-provider-capabilities/0.1'

const PRESETS = Object.freeze({
  minimal: {
    provider: 'openai-compatible-local',
    endpoint: 'http://127.0.0.1:8000/v1/chat/completions',
    capabilities: {
      protocol: 'openai-chat-completions', streaming: true,
      structuredOutput: 'prompt-only', toolCalling: false,
      toolChoiceControl: false, parallelToolCallsControl: false,
      strictToolSchema: false, reasoningEffort: false,
    },
    notes: ['Conservative compatibility baseline.'],
  },
  lmstudio: {
    provider: 'lmstudio',
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    capabilities: {
      protocol: 'openai-chat-completions', streaming: true,
      structuredOutput: 'json-schema', toolCalling: true,
      toolChoiceControl: false, parallelToolCallsControl: false,
      strictToolSchema: false, reasoningEffort: false,
    },
    notes: [
      'LM Studio OpenAI-compatible Chat Completions on the default local port 1234.',
      'Structured output and tool use are server-supported, but small-model quality remains an empirical certification concern.',
      'tool_choice and parallel_tool_calls controls are not assumed unless separately certified.',
    ],
  },
  ollama: {
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    capabilities: {
      protocol: 'openai-chat-completions', streaming: true,
      structuredOutput: 'json-schema', toolCalling: true,
      toolChoiceControl: true, parallelToolCallsControl: false,
      strictToolSchema: false, reasoningEffort: true,
    },
    notes: ['OpenAI-compatible chat endpoint; parallel_tool_calls request control is kept conservative.'],
  },
  vllm: {
    provider: 'vllm',
    endpoint: 'http://127.0.0.1:8000/v1/chat/completions',
    capabilities: {
      protocol: 'openai-chat-completions', streaming: true,
      structuredOutput: 'json-schema', toolCalling: true,
      toolChoiceControl: true, parallelToolCallsControl: true,
      strictToolSchema: true, reasoningEffort: false,
    },
    notes: ['Tool behavior still depends on model/parser/server launch configuration.'],
  },
  'llama.cpp': {
    provider: 'llama.cpp',
    endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    capabilities: {
      protocol: 'openai-chat-completions', streaming: true,
      structuredOutput: 'prompt-only', toolCalling: true,
      toolChoiceControl: false, parallelToolCallsControl: false,
      strictToolSchema: false, reasoningEffort: false,
    },
    notes: ['Tool calling requires a tool-use compatible chat template (commonly --jinja). Structured-output enforcement defaults to prompt-only until server/model capability is explicitly certified.'],
  },
})

function bool(value, fallback = false) { return value === undefined ? fallback : Boolean(value) }

export function normalizeProviderCapabilities(input = {}) {
  const structured = input.structuredOutput || 'prompt-only'
  if (!['json-schema', 'json-object', 'prompt-only', 'none'].includes(structured)) throw new Error(`Unsupported structuredOutput capability ${structured}`)
  return {
    schema: PPL_PROVIDER_CAPABILITIES_SCHEMA,
    protocol: input.protocol || 'openai-chat-completions',
    streaming: bool(input.streaming, true),
    structuredOutput: structured,
    toolCalling: bool(input.toolCalling),
    toolChoiceControl: bool(input.toolChoiceControl),
    parallelToolCallsControl: bool(input.parallelToolCallsControl),
    strictToolSchema: bool(input.strictToolSchema),
    reasoningEffort: bool(input.reasoningEffort),
  }
}

export function localProviderPreset(name = 'minimal', overrides = {}) {
  const preset = PRESETS[name]
  if (!preset) throw new Error(`Unknown local provider preset ${name}`)
  return {
    name,
    provider: overrides.provider || preset.provider,
    endpoint: overrides.endpoint || preset.endpoint,
    capabilities: normalizeProviderCapabilities({ ...preset.capabilities, ...(overrides.capabilities || {}) }),
    notes: [...preset.notes],
  }
}

export function listLocalProviderPresets() { return Object.keys(PRESETS) }

export function assessRequestCapabilities(request = {}, capabilitiesInput = {}) {
  const capabilities = normalizeProviderCapabilities(capabilitiesInput)
  const degradations = []
  const blockers = []
  const hasTools = Array.isArray(request.transportTools) && request.transportTools.length > 0
  if (hasTools && !capabilities.toolCalling) blockers.push('tool-calling-not-supported')
  if (request.transportToolChoice !== undefined && !capabilities.toolChoiceControl) {
    if (request.transportToolChoice === 'none') degradations.push('tool-choice-none-enforced-by-withholding-tools')
    else if (request.transportToolChoice === 'auto') degradations.push('tool-choice-auto-uses-server-default')
    else blockers.push('explicit-tool-choice-not-supported')
  }
  if (typeof request.transportParallelToolCalls === 'boolean' && !capabilities.parallelToolCallsControl) {
    degradations.push('parallel-tool-call-control-unavailable')
  }
  if (capabilities.structuredOutput === 'prompt-only') degradations.push('structured-output-prompt-enforced-host-validated')
  if (capabilities.structuredOutput === 'none') blockers.push('structured-output-contract-not-supported')
  return { capabilities, blockers, degradations, ok: blockers.length === 0 }
}
