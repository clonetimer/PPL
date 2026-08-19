#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateProfile, runProfileScenario, toAppSession } from '../packages/profile-core/src/index.mjs'

async function load(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'))
}

function usage() {
  console.log(`PPL Profiles 0.1.0\n\nCommands:\n  validate <profile.json>\n  validate-all\n  simulate <profile.json> <scenario.json>\n  export-app <profile.json> <scenario.json>\n`)
}

const [command, ...args] = process.argv.slice(2)
if (!command || command === '--help' || command === '-h') { usage(); process.exit(0) }

if (command === 'validate') {
  const profile = await load(args[0])
  const errors = validateProfile(profile)
  console.log(JSON.stringify({ schema: 'ppl.profile-validation/0.1', passed: errors.length === 0, profile: profile.id, errors }, null, 2))
  process.exit(errors.length ? 1 : 0)
}

if (command === 'validate-all') {
  const paths = ['character', 'tutor', 'research', 'life'].map(name => `profiles/${name}/profile.json`)
  const results = []
  for (const path of paths) {
    const profile = await load(path)
    const errors = validateProfile(profile)
    results.push({ profile: profile.id, passed: errors.length === 0, errors })
  }
  const passed = results.every(x => x.passed)
  console.log(JSON.stringify({ schema: 'ppl.profile-validation-suite/0.1', passed, results }, null, 2))
  process.exit(passed ? 0 : 1)
}

if (command === 'simulate' || command === 'export-app') {
  const profile = await load(args[0])
  const scenario = await load(args[1])
  const result = runProfileScenario(profile, scenario)
  console.log(JSON.stringify(command === 'export-app' ? toAppSession(profile, result) : result, null, 2))
  process.exit(0)
}

usage()
process.exit(2)
