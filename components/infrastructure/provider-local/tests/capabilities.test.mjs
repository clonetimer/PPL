import test from 'node:test'
import assert from 'node:assert/strict'
import { assessRequestCapabilities, listLocalProviderPresets, localProviderPreset } from '../src/capabilities.mjs'

test('provider presets are explicit and conservative', () => {
  assert.deepEqual(listLocalProviderPresets(), ['minimal','lmstudio','ollama','vllm','llama.cpp'])
  const lmstudio = localProviderPreset('lmstudio')
  assert.equal(lmstudio.endpoint, 'http://127.0.0.1:1234/v1/chat/completions')
  assert.equal(lmstudio.capabilities.structuredOutput, 'json-schema')
  assert.equal(lmstudio.capabilities.toolCalling, true)
  assert.equal(lmstudio.capabilities.toolChoiceControl, false)
  const ollama = localProviderPreset('ollama')
  assert.equal(ollama.capabilities.structuredOutput, 'json-schema')
  assert.equal(ollama.capabilities.toolCalling, true)
  assert.equal(ollama.capabilities.parallelToolCallsControl, false)
  const llama = localProviderPreset('llama.cpp')
  assert.equal(llama.capabilities.structuredOutput, 'prompt-only')
})

test('capability negotiation blocks unavailable tools but supports safe degradation', () => {
  const request = { transportTools: [{ name: 'lookup' }], transportToolChoice: 'none', transportParallelToolCalls: false }
  const blocked = assessRequestCapabilities(request, localProviderPreset('minimal').capabilities)
  assert.equal(blocked.ok, false)
  assert.ok(blocked.blockers.includes('tool-calling-not-supported'))

  const degraded = assessRequestCapabilities(request, localProviderPreset('llama.cpp').capabilities)
  assert.equal(degraded.ok, true)
  assert.ok(degraded.degradations.includes('tool-choice-none-enforced-by-withholding-tools'))
  assert.ok(degraded.degradations.includes('parallel-tool-call-control-unavailable'))
})
