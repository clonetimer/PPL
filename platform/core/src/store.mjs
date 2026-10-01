import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const now = () => new Date().toISOString()

function stableStringify(value) {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : stableStringify(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export class RevisionConflictError extends Error {
  constructor(namespace, id, expected, actual) {
    super(`revision conflict ${namespace}/${id}: expected=${expected} actual=${actual}`)
    this.name = 'RevisionConflictError'
    this.code = 'REVISION_CONFLICT'
  }
}

export class IdempotencyConflictError extends Error {
  constructor(scope, key) {
    super(`idempotency key reused with different payload: ${scope}/${key}`)
    this.name = 'IdempotencyConflictError'
    this.code = 'IDEMPOTENCY_CONFLICT'
  }
}

export class MemoryRecordStore {
  constructor() {
    this.records = new Map()
    this.events = new Map()
    this.idempotency = new Map()
  }

  #recordKey(namespace, id) { return `${namespace}\u0000${id}` }
  #eventKey(namespace, eventId) { return `${namespace}\u0000${eventId}` }
  #idemKey(scope, key) { return `${scope}\u0000${key}` }

  create(namespace, id, value) {
    const key = this.#recordKey(namespace, id)
    if (this.records.has(key)) throw new Error(`record already exists: ${namespace}/${id}`)
    const at = now()
    const row = { namespace, id, revision: 1, value: clone(value), createdAt: at, updatedAt: at }
    this.records.set(key, row)
    return clone(row)
  }

  get(namespace, id) {
    const row = this.records.get(this.#recordKey(namespace, id))
    return row ? clone(row) : null
  }

  list(namespace) {
    return [...this.records.values()].filter(row => row.namespace === namespace).map(clone).sort((a, b) => a.id.localeCompare(b.id))
  }

  save(namespace, id, value, options = {}) {
    const key = this.#recordKey(namespace, id)
    const current = this.records.get(key)
    if (!current) throw new Error(`record not found: ${namespace}/${id}`)
    if (options.expectedRevision !== undefined && current.revision !== options.expectedRevision) {
      throw new RevisionConflictError(namespace, id, options.expectedRevision, current.revision)
    }
    const row = { ...current, value: clone(value), revision: current.revision + 1, updatedAt: now() }
    this.records.set(key, row)
    return clone(row)
  }

  claimIdempotency(scope, key, payload) {
    const mapKey = this.#idemKey(scope, key)
    const fp = fingerprint(payload)
    const current = this.idempotency.get(mapKey)
    if (current) {
      if (current.fingerprint !== fp) throw new IdempotencyConflictError(scope, key)
      return { accepted: false, duplicate: true, fingerprint: fp, createdAt: current.createdAt }
    }
    const createdAt = now()
    this.idempotency.set(mapKey, { fingerprint: fp, createdAt })
    return { accepted: true, duplicate: false, fingerprint: fp, createdAt }
  }

  appendEvent(namespace, streamId, event) {
    const eventId = String(event.eventId || '').trim()
    if (!eventId) throw new Error('event.eventId required')
    const eventKey = this.#eventKey(namespace, eventId)
    const canonical = { streamId: String(streamId), type: String(event.type || ''), payload: clone(event.payload ?? {}), at: String(event.at || '') }
    const current = this.events.get(eventKey)
    if (current) {
      if (fingerprint(current.canonical) !== fingerprint(canonical)) throw new IdempotencyConflictError(namespace, eventId)
      return { ...clone(current.row), duplicate: true }
    }
    const seq = [...this.events.values()].filter(x => x.row.namespace === namespace && x.row.streamId === String(streamId)).length + 1
    const row = { namespace, streamId: String(streamId), seq, eventId, type: canonical.type, payload: canonical.payload, at: event.at || now() }
    this.events.set(eventKey, { canonical, row })
    return { ...clone(row), duplicate: false }
  }

  listEvents(namespace, streamId) {
    return [...this.events.values()].map(x => x.row).filter(row => row.namespace === namespace && row.streamId === String(streamId)).sort((a, b) => a.seq - b.seq).map(clone)
  }

  close() {}
}

export class SqliteRecordStore {
  constructor(filePath) {
    if (!filePath) throw new Error('sqlite filePath required')
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
    this.filePath = path.resolve(filePath)
    this.db = new DatabaseSync(this.filePath)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ppl_records (
        namespace TEXT NOT NULL,
        id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        value_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, id)
      );
      CREATE TABLE IF NOT EXISTS ppl_events (
        namespace TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        at TEXT NOT NULL,
        canonical_fingerprint TEXT NOT NULL,
        PRIMARY KEY(namespace, event_id),
        UNIQUE(namespace, stream_id, seq)
      );
      CREATE TABLE IF NOT EXISTS ppl_idempotency (
        scope TEXT NOT NULL,
        idem_key TEXT NOT NULL,
        payload_fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(scope, idem_key)
      );
    `)
  }

  create(namespace, id, value) {
    const at = now()
    try {
      this.db.prepare('INSERT INTO ppl_records(namespace,id,revision,value_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        .run(namespace, String(id), 1, stableStringify(value), at, at)
    } catch (error) {
      if (String(error.message).includes('UNIQUE') || String(error.message).includes('PRIMARY KEY')) throw new Error(`record already exists: ${namespace}/${id}`)
      throw error
    }
    return this.get(namespace, id)
  }

  get(namespace, id) {
    const row = this.db.prepare('SELECT * FROM ppl_records WHERE namespace=? AND id=?').get(namespace, String(id))
    if (!row) return null
    return { namespace: row.namespace, id: row.id, revision: Number(row.revision), value: JSON.parse(row.value_json), createdAt: row.created_at, updatedAt: row.updated_at }
  }

  list(namespace) {
    return this.db.prepare('SELECT * FROM ppl_records WHERE namespace=? ORDER BY id').all(namespace).map(row => ({
      namespace: row.namespace, id: row.id, revision: Number(row.revision), value: JSON.parse(row.value_json), createdAt: row.created_at, updatedAt: row.updated_at,
    }))
  }

  save(namespace, id, value, options = {}) {
    const current = this.get(namespace, id)
    if (!current) throw new Error(`record not found: ${namespace}/${id}`)
    if (options.expectedRevision !== undefined && current.revision !== options.expectedRevision) {
      throw new RevisionConflictError(namespace, id, options.expectedRevision, current.revision)
    }
    const revision = current.revision + 1
    const updatedAt = now()
    const result = this.db.prepare('UPDATE ppl_records SET revision=?, value_json=?, updated_at=? WHERE namespace=? AND id=? AND revision=?')
      .run(revision, stableStringify(value), updatedAt, namespace, String(id), current.revision)
    if (Number(result.changes) !== 1) {
      const actual = this.get(namespace, id)?.revision
      throw new RevisionConflictError(namespace, id, current.revision, actual)
    }
    return this.get(namespace, id)
  }

  claimIdempotency(scope, key, payload) {
    const fp = fingerprint(payload)
    const current = this.db.prepare('SELECT payload_fingerprint,created_at FROM ppl_idempotency WHERE scope=? AND idem_key=?').get(scope, String(key))
    if (current) {
      if (current.payload_fingerprint !== fp) throw new IdempotencyConflictError(scope, key)
      return { accepted: false, duplicate: true, fingerprint: fp, createdAt: current.created_at }
    }
    const createdAt = now()
    this.db.prepare('INSERT INTO ppl_idempotency(scope,idem_key,payload_fingerprint,created_at) VALUES(?,?,?,?)').run(scope, String(key), fp, createdAt)
    return { accepted: true, duplicate: false, fingerprint: fp, createdAt }
  }

  appendEvent(namespace, streamId, event) {
    const eventId = String(event.eventId || '').trim()
    if (!eventId) throw new Error('event.eventId required')
    const canonical = { streamId: String(streamId), type: String(event.type || ''), payload: clone(event.payload ?? {}), at: String(event.at || '') }
    const fp = fingerprint(canonical)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT * FROM ppl_events WHERE namespace=? AND event_id=?').get(namespace, eventId)
      if (existing) {
        if (existing.canonical_fingerprint !== fp) throw new IdempotencyConflictError(namespace, eventId)
        this.db.exec('COMMIT')
        return { namespace, streamId: existing.stream_id, seq: Number(existing.seq), eventId, type: existing.type, payload: JSON.parse(existing.payload_json), at: existing.at, duplicate: true }
      }
      const next = this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM ppl_events WHERE namespace=? AND stream_id=?').get(namespace, String(streamId)).seq
      const at = event.at || now()
      this.db.prepare('INSERT INTO ppl_events(namespace,stream_id,seq,event_id,type,payload_json,at,canonical_fingerprint) VALUES(?,?,?,?,?,?,?,?)')
        .run(namespace, String(streamId), Number(next), eventId, canonical.type, stableStringify(canonical.payload), at, fp)
      this.db.exec('COMMIT')
      return { namespace, streamId: String(streamId), seq: Number(next), eventId, type: canonical.type, payload: canonical.payload, at, duplicate: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listEvents(namespace, streamId) {
    return this.db.prepare('SELECT * FROM ppl_events WHERE namespace=? AND stream_id=? ORDER BY seq').all(namespace, String(streamId)).map(row => ({
      namespace: row.namespace, streamId: row.stream_id, seq: Number(row.seq), eventId: row.event_id, type: row.type, payload: JSON.parse(row.payload_json), at: row.at,
    }))
  }

  close() { this.db.close() }
}

export function createProductStore(options = {}) {
  if (options.store) return options.store
  const driver = options.driver || process.env.PPL_STORE || 'sqlite'
  if (driver === 'memory') return new MemoryRecordStore()
  if (driver !== 'sqlite') throw new Error(`unsupported PPL_STORE: ${driver}`)
  const filePath = options.filePath || process.env.PPL_DB || path.resolve(process.cwd(), 'var/ppl-product.sqlite')
  return new SqliteRecordStore(filePath)
}
