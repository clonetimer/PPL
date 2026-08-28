#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const components = JSON.parse(fs.readFileSync(path.join(root, 'manifest', 'COMPONENTS.json'), 'utf8')).components
const failures = []

for (const c of components) {
  const dir = path.join(root, c.path)
  const packageJson = path.join(dir, 'package.json')
  if (!fs.existsSync(dir)) {
    failures.push(`missing component directory: ${c.path}`)
    continue
  }
  if (fs.existsSync(packageJson)) {
    const p = JSON.parse(fs.readFileSync(packageJson, 'utf8'))
    if (p.version !== c.version) failures.push(`version mismatch ${c.id}: manifest=${c.version} package=${p.version}`)
  }
  if (c.dist && !fs.existsSync(path.join(root, c.dist))) failures.push(`missing dist artifact: ${c.dist}`)
}

const sumsPath = path.join(root, 'manifest', 'SHA256SUMS.txt')
if (fs.existsSync(sumsPath)) {
  const lines = fs.readFileSync(sumsPath, 'utf8').split(/\r?\n/).filter(Boolean)
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{64})  (.+)$/)
    if (!m) { failures.push(`invalid checksum line: ${line}`); continue }
    const [, expected, rel] = m
    const fp = path.join(root, rel)
    if (!fs.existsSync(fp)) { failures.push(`checksum target missing: ${rel}`); continue }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex')
    if (actual !== expected) failures.push(`checksum mismatch: ${rel}`)
  }
}

if (failures.length) {
  console.error(JSON.stringify({schema:'ppl.project-verify/1', passed:false, failures}, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({schema:'ppl.project-verify/1', passed:true, components:components.length, checksumManifest:fs.existsSync(sumsPath)}, null, 2))
