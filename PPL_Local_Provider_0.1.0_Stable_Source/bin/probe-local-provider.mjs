#!/usr/bin/env node
import { localProviderPreset, listLocalProviderPresets } from '../src/capabilities.mjs'
import { discoverVisibleModels, resolveVisibleModel } from '../src/discovery.mjs'

function arg(name, fallback = null) { const p = process.argv.find(x => x.startsWith(`--${name}=`)); return p ? p.slice(name.length + 3) : fallback }
const presetName = arg('preset', process.env.PPL_LOCAL_PRESET || 'lmstudio')
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ status: 'dry-run', presets: listLocalProviderPresets(), selected: localProviderPreset(presetName) }, null, 2)); process.exit(0)
}
const preset = localProviderPreset(presetName, { endpoint: arg('endpoint', process.env.PPL_LOCAL_ENDPOINT || '') || undefined })
const explicitModel = arg('model', process.env.PPL_LOCAL_MODEL || '')
const modelHint = arg('model-hint', process.env.PPL_LOCAL_MODEL_HINT || '')
const apiKey = arg('api-key', process.env.PPL_LOCAL_API_KEY || process.env.LM_API_TOKEN || '') || undefined
try {
  const discovered = await discoverVisibleModels({ endpoint: preset.endpoint, apiKey, timeoutMs: Number(arg('timeout-ms', '4000')) })
  const resolution = resolveVisibleModel(discovered.modelIds, { model: explicitModel, hint: modelHint })
  const ok = resolution.status === 'selected' || (!explicitModel && !modelHint)
  const result = { status: ok ? 'reachable' : resolution.status, preset: presetName, modelsEndpoint: discovered.modelsEndpoint, modelIds: discovered.modelIds, resolution }
  console.log(JSON.stringify(result, null, 2))
  if (ok) process.exit(0)
  process.exit(resolution.status === 'model-ambiguous' ? 5 : 4)
} catch (error) {
  console.log(JSON.stringify({ status: 'not-reachable', preset: presetName, endpoint: preset.endpoint, error: error.message, httpStatus: error.status || null }, null, 2)); process.exit(3)
}
