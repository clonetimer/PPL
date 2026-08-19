export const PPL_HOST_SNAPSHOT_SCHEMA = 'ppl.host-snapshot/0.1'
export const PPL_HOST_RESOLUTION_SCHEMA = 'ppl.host-resolution/0.1'
export const PPL_LEGACY_SNAPSHOT_SCHEMAS = new Set(['ppl.dsh/snapshot/0.1'])

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function toJsonSafe(value, path = '$') {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path}: non-finite number is not JSON-safe`)
    return value
  }
  if (type === 'undefined') return undefined
  if (type === 'bigint' || type === 'symbol' || type === 'function') {
    throw new TypeError(`${path}: ${type} is not JSON-safe`)
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const json = toJsonSafe(item, `${path}[${index}]`)
      if (json === undefined) throw new TypeError(`${path}[${index}]: undefined array item is not JSON-safe`)
      return json
    })
  }
  if (!isPlainObject(value)) {
    const ctor = value?.constructor?.name ?? 'unknown object'
    throw new TypeError(`${path}: ${ctor} is not a JSON plain object`)
  }
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    const json = toJsonSafe(item, `${path}.${key}`)
    if (json !== undefined) out[key] = json
  }
  return out
}

export function toHostResolution(resolution) {
  return toJsonSafe({
    schema: PPL_HOST_RESOLUTION_SCHEMA,
    coreSchema: resolution.schema,
    activeRules: resolution.activeRules ?? [],
    activeTransitions: resolution.activeTransitions ?? [],
    resolved: resolution.resolved ?? {},
    trace: resolution.trace ?? {},
    pendingCommits: resolution.pendingCommits ?? [],
    pendingTransitions: resolution.pendingTransitions ?? [],
    invariantResults: resolution.invariantResults ?? [],
    diagnostics: resolution.diagnostics ?? [],
    valid: resolution.valid === true,
  }, '$.resolution')
}

export function createHostSnapshot(input) {
  return toJsonSafe({
    schema: PPL_HOST_SNAPSHOT_SCHEMA,
    persona: {
      id: input.persona.id,
      version: input.persona.version,
      irSha256: input.persona.irSha256,
    },
    host: {
      kind: String(input.host?.kind ?? 'unknown'),
      turn: Number(input.turn),
      step: Number(input.step),
    },
    // 0.1 compatibility aliases. Consumers SHOULD prefer host.turn/host.step.
    turn: Number(input.turn),
    step: Number(input.step),
    event: input.event,
    context: input.context,
    resolution: toHostResolution(input.resolution),
  })
}

export function isPplSnapshotSchema(schema) {
  return schema === PPL_HOST_SNAPSHOT_SCHEMA || PPL_LEGACY_SNAPSHOT_SCHEMAS.has(schema)
}

export function assertJsonRoundTrip(value) {
  const text = JSON.stringify(value)
  if (typeof text !== 'string') throw new TypeError('snapshot did not stringify to JSON')
  return JSON.parse(text)
}
