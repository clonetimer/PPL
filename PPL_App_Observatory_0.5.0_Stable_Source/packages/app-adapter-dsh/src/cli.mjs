#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { projectDshSession } from './index.mjs'

const input = process.argv[2]
if (!input) {
  console.error('Usage: ppl-app-dsh-project <dsh-session-export.json>')
  process.exit(2)
}
const data = JSON.parse(await readFile(resolve(input), 'utf8'))
console.log(JSON.stringify(projectDshSession(data), null, 2))
