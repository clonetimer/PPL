import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const LLM_TOOL_RESULT_SCHEMA = 'ppl.llm-tool-result/0.1'

function sha(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function validateScalar(value, schema, path, errors) {
  if (!schema) return
  const type = schema.type
  if (type === 'string' && typeof value !== 'string') errors.push(`${path} must be string`)
  if (type === 'number' && typeof value !== 'number') errors.push(`${path} must be number`)
  if (type === 'integer' && (!Number.isInteger(value))) errors.push(`${path} must be integer`)
  if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${path} must be boolean`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(', ')}`)
}

export function validateToolArguments(schema = {}, args) {
  const errors = []
  if (schema.type === 'object') {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { valid: false, errors: ['$ must be object'] }
    const properties = schema.properties || {}
    for (const required of schema.required || []) if (!(required in args)) errors.push(`$.${required} is required`)
    for (const [key, value] of Object.entries(args)) {
      if (!properties[key]) {
        if (schema.additionalProperties === false) errors.push(`$.${key} is not allowed`)
        continue
      }
      const child = properties[key]
      if (child.type === 'object') {
        const nested = validateToolArguments(child, value)
        errors.push(...nested.errors.map(x => `$.${key}${x.slice(1)}`))
      } else if (child.type === 'array') {
        if (!Array.isArray(value)) errors.push(`$.${key} must be array`)
        else if (child.items) value.forEach((v, i) => validateScalar(v, child.items, `$.${key}[${i}]`, errors))
      } else validateScalar(value, child, `$.${key}`, errors)
    }
  } else validateScalar(args, schema, '$', errors)
  return { valid: errors.length === 0, errors }
}

export function createToolRegistry(definitions = []) {
  const map = new Map()
  for (const def of definitions) {
    if (!def?.name || typeof def.execute !== 'function') throw new Error('Tool definition requires name and execute')
    if (map.has(def.name)) throw new Error(`Duplicate tool ${def.name}`)
    map.set(def.name, {
      name: def.name,
      description: def.description || '',
      parameters: def.parameters || { type: 'object', properties: {}, additionalProperties: false },
      execute: def.execute,
      provenance: def.provenance || 'host-tool',
    })
  }
  return {
    list() { return [...map.values()].map(({ execute, ...rest }) => rest) },
    has(name) { return map.has(name) },
    get(name) { return map.get(name) || null },
  }
}

export async function executeToolCall(registry, call, context = {}) {
  if (!registry?.has(call?.name)) throw new Error(`Tool ${call?.name || '<missing>'} is not allowlisted`)
  const tool = registry.get(call.name)
  let args = call.arguments
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch { throw new Error(`Tool ${call.name} arguments are not valid JSON`) }
  }
  const validation = validateToolArguments(tool.parameters, args)
  if (!validation.valid) throw new Error(`Tool ${call.name} argument validation failed: ${validation.errors.join('; ')}`)
  const startedAt = new Date().toISOString()
  const output = await tool.execute(args, context)
  const completedAt = new Date().toISOString()
  const result = {
    schema: LLM_TOOL_RESULT_SCHEMA,
    callId: call.callId || `tool:${randomUUID()}`,
    name: call.name,
    arguments: args,
    output,
    provenance: {
      kind: tool.provenance,
      hostOwned: true,
      startedAt,
      completedAt,
      digest: sha({ name: call.name, arguments: args, output }),
    },
  }
  return result
}


export class MemoryToolExecutionStore {
  #entries = new Map()
  async get(callId) { return this.#entries.get(String(callId)) || null }
  async set(callId, entry) { this.#entries.set(String(callId), entry) }
  async delete(callId) { this.#entries.delete(String(callId)) }
  async size() { return this.#entries.size }
}

export class JsonFileToolExecutionStore {
  constructor(filePath) {
    if (!filePath) throw new Error('JsonFileToolExecutionStore requires file path')
    this.filePath = path.resolve(filePath)
    this.loaded = false
    this.entries = {}
    this.writeTail = Promise.resolve()
  }

  async #load() {
    if (this.loaded) return
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const data = JSON.parse(raw)
      this.entries = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.entries = {}
    }
    this.loaded = true
  }

  async #persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.entries, null, 2) + '\n', 'utf8')
    await fs.rename(tmp, this.filePath)
  }

  async get(callId) { await this.#load(); return this.entries[String(callId)] || null }
  async set(callId, entry) {
    await this.#load()
    const key = String(callId)
    this.entries[key] = entry
    this.writeTail = this.writeTail.then(() => this.#persist())
    await this.writeTail
  }
  async delete(callId) {
    await this.#load()
    delete this.entries[String(callId)]
    this.writeTail = this.writeTail.then(() => this.#persist())
    await this.writeTail
  }
  async size() { await this.#load(); return Object.keys(this.entries).length }
}

export class AppendOnlyJsonlToolExecutionStore {
  constructor(filePath) {
    if (!filePath) throw new Error('AppendOnlyJsonlToolExecutionStore requires file path')
    this.filePath = path.resolve(filePath)
    this.loaded = false
    this.entries = {}
    this.writeTail = Promise.resolve()
  }

  async #load() {
    if (this.loaded) return
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const lines = raw.split(/\r?\n/).filter(Boolean)
      const entries = {}
      for (let index = 0; index < lines.length; index += 1) {
        let row
        try { row = JSON.parse(lines[index]) } catch (error) {
          throw new Error(`Invalid JSONL tool ledger record at line ${index + 1}`, { cause: error })
        }
        const callId = String(row?.callId || '')
        if (!callId) throw new Error(`JSONL tool ledger record at line ${index + 1} is missing callId`)
        if (row.deleted === true) delete entries[callId]
        else if (row.entry && typeof row.entry === 'object') entries[callId] = row.entry
        else throw new Error(`JSONL tool ledger record at line ${index + 1} is missing entry`)
      }
      this.entries = entries
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.entries = {}
    }
    this.loaded = true
  }

  async #append(record) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const handle = await fs.open(this.filePath, 'a')
    try {
      await handle.writeFile(JSON.stringify(record) + '\n', 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async get(callId) { await this.#load(); return this.entries[String(callId)] || null }
  async set(callId, entry) {
    await this.#load()
    const key = String(callId)
    this.entries[key] = entry
    this.writeTail = this.writeTail.then(() => this.#append({ callId: key, entry }))
    await this.writeTail
  }
  async delete(callId) {
    await this.#load()
    const key = String(callId)
    delete this.entries[key]
    this.writeTail = this.writeTail.then(() => this.#append({ callId: key, deleted: true }))
    await this.writeTail
  }
  async size() { await this.#load(); return Object.keys(this.entries).length }
}

export class ToolExecutionLedger {
  constructor(options = {}) {
    this.store = options.store || new MemoryToolExecutionStore()
  }

  async execute(registry, call, context = {}) {
    const callId = String(call?.callId || '')
    if (!callId) throw new Error('Tool callId is required for idempotent execution')
    let args = call.arguments
    if (typeof args === 'string') {
      try { args = JSON.parse(args) } catch { throw new Error(`Tool ${call.name} arguments are not valid JSON`) }
    }
    const identity = sha({ name: call.name, arguments: args })
    const existing = await this.store.get(callId)
    if (existing) {
      if (existing.identity !== identity) throw new Error(`Tool callId ${callId} was reused with different name/arguments`)
      return { ...existing.result, replayed: true }
    }
    const result = await executeToolCall(registry, { ...call, callId, arguments: args }, context)
    await this.store.set(callId, { identity, result })
    return { ...result, replayed: false }
  }

  async has(callId) { return Boolean(await this.store.get(String(callId))) }
  async size() { return this.store.size() }
}

export function toolResultToModelInput(result) {
  if (result?.schema !== LLM_TOOL_RESULT_SCHEMA) throw new Error('Invalid tool result')
  return {
    type: 'function_call_output',
    call_id: result.callId,
    output: JSON.stringify({ output: result.output, provenance: result.provenance }),
  }
}
