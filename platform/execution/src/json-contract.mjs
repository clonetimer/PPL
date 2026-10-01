// Deliberately limited, fail-closed validator for PPL's owned response contracts.
// Not a general JSON Schema implementation. Unsupported keywords are configuration errors.
const supported = new Set(['type','enum','const','anyOf','properties','required','additionalProperties',
  'items','minItems','maxItems','minLength','maxLength','minimum','maximum','description','title','$schema'])
const types = new Set(['object','array','string','number','integer','boolean','null'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
function assertSchema(schema, depth = 0) {
  if (!object(schema) || depth > 32) throw new Error('PPL response contract must be a bounded schema object')
  for (const key of Object.keys(schema)) if (!supported.has(key)) throw new Error(`Unsupported PPL response contract keyword: ${key}`)
  if (schema.type !== undefined && !types.has(schema.type)) throw new Error('Unsupported PPL response contract type')
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every(x => typeof x === 'string'))) throw new Error('Invalid required constraint')
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) throw new Error('Invalid enum constraint')
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') throw new Error('Only boolean additionalProperties is supported')
  for (const name of ['minItems','maxItems','minLength','maxLength']) if (schema[name] !== undefined && (!Number.isSafeInteger(schema[name]) || schema[name] < 0)) throw new Error(`Invalid ${name} constraint`)
  for (const name of ['minimum','maximum']) if (schema[name] !== undefined && !Number.isFinite(schema[name])) throw new Error(`Invalid ${name} constraint`)
  if (schema.properties !== undefined) {
    if (!object(schema.properties)) throw new Error('Invalid properties constraint')
    for (const child of Object.values(schema.properties)) assertSchema(child, depth + 1)
  }
  if (schema.items !== undefined) assertSchema(schema.items, depth + 1)
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || !schema.anyOf.length) throw new Error('Invalid anyOf constraint')
    for (const child of schema.anyOf) assertSchema(child, depth + 1)
  }
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function matchesType(value, type) {
  if (type === 'null') return value === null
  if (type === 'object') return object(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return Number.isSafeInteger(value)
  return typeof value === type
}
function visit(value, schema, path, issues, depth = 0) {
  const fail = code => { if (issues.length < 50) issues.push({ path, code }) }
  if (depth > 32) { fail('DEPTH_LIMIT'); return }
  if (schema.type !== undefined && !matchesType(value, schema.type)) { fail('TYPE'); return }
  if (schema.enum && !schema.enum.some(x => equal(x, value))) fail('ENUM')
  if (own(schema, 'const') && !equal(value, schema.const)) fail('CONST')
  if (schema.anyOf && !schema.anyOf.some(branch => { const nested=[]; visit(value, branch, path, nested, depth + 1); return !nested.length })) fail('ANY_OF')
  if (object(value)) {
    const properties = schema.properties || {}
    for (const key of schema.required || []) if (!own(value, key)) { if (issues.length < 50) issues.push({ path: `${path}/${key}`, code: 'REQUIRED' }) }
    for (const key of Object.keys(value)) {
      if (own(properties, key)) visit(value[key], properties[key], `${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`, issues, depth + 1)
      else if (schema.additionalProperties === false) fail('ADDITIONAL_PROPERTY') // Do not echo untrusted keys.
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('MIN_ITEMS')
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('MAX_ITEMS')
    if (schema.items) for (let i=0; i<value.length && issues.length<50; i++) visit(value[i], schema.items, `${path}/${i}`, issues, depth + 1)
  }
  if (typeof value === 'string') {
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength) fail('MIN_LENGTH')
    if (schema.maxLength !== undefined && length > schema.maxLength) fail('MAX_LENGTH')
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('FINITE_NUMBER')
    if (schema.minimum !== undefined && value < schema.minimum) fail('MINIMUM')
    if (schema.maximum !== undefined && value > schema.maximum) fail('MAXIMUM')
  }
}
export function validateJsonContract(value, schema) {
  assertSchema(schema)
  const issues = []; visit(value, schema, '$', issues)
  return { valid: issues.length === 0, issues }
}
