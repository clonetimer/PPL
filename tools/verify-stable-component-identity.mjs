#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const baseline = path.join(root, 'provenance', 'STABLE_BASELINE_SHA256SUMS_2026-08-27.txt')
const prefixes = ['components/', 'dist/', 'rules/']
const failures = []
let checked = 0
for (const line of fs.readFileSync(baseline, 'utf8').split(/\r?\n/).filter(Boolean)) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/)
  if (!match) continue
  const [, expected, rel] = match
  if (!prefixes.some(prefix => rel.startsWith(prefix))) continue
  const file = path.join(root, rel)
  if (!fs.existsSync(file)) { failures.push(`missing stable artifact: ${rel}`); continue }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  checked += 1
  if (actual !== expected) failures.push(`stable artifact changed: ${rel}`)
}
if (failures.length) {
  console.error(JSON.stringify({ schema: 'ppl.stable-component-identity/1', passed: false, checked, failures }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({ schema: 'ppl.stable-component-identity/1', passed: true, checked }, null, 2))
