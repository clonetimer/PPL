#!/usr/bin/env node
import fs from 'node:fs'
import { validateExperienceRule } from '../src/index.mjs'
const file = process.argv[2]
if (!file) { console.error('usage: ppl-experience-rule-inspect <rule.json>'); process.exit(2) }
const rule = JSON.parse(fs.readFileSync(file, 'utf8'))
const result = validateExperienceRule(rule)
console.log(JSON.stringify(result, null, 2))
process.exit(result.valid ? 0 : 1)
