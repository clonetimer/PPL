#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateProfile, toAppSession } from '../packages/profile-core/src/index.mjs'
import { runProfileScenario } from '../packages/profile-runtime/src/index.mjs'
import { assistmentsCsvToScenario, summarizeAssistmentsCsv } from '../packages/profile-tutor/src/adapters/assistments.mjs'

async function load(path) { return JSON.parse(await readFile(resolve(path), 'utf8')) }

function usage() {
  console.log(`PPL Profiles 0.2.0 Stable\n\nCommands:\n  validate <profile.json>\n  validate-all\n  simulate <profile.json> <scenario.json>\n  export-app <profile.json> <scenario.json>\n  inspect-assistments <csv>\n  import-assistments <csv> [--user ID] [--skill ID] [--max N] [--original-only] [--out FILE]\n  replay-assistments <csv> [--user ID] [--skill ID] [--max N] [--original-only] [--app] [--out FILE]\n`)
}

function flagValue(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const [command, ...args] = process.argv.slice(2)
if (!command || command === '--help' || command === '-h') { usage(); process.exit(0) }

if (command === 'validate') {
  const profile = await load(args[0])
  const errors = validateProfile(profile)
  console.log(JSON.stringify({ schema: 'ppl.profile-validation/0.2', passed: errors.length === 0, profile: profile.id, errors }, null, 2))
  process.exit(errors.length ? 1 : 0)
}

if (command === 'validate-all') {
  const paths = ['character', 'tutor', 'research', 'life'].map(name => `profiles/${name}/profile.json`)
  const results = []
  for (const path of paths) {
    const profile = await load(path)
    const errors = validateProfile(profile)
    results.push({ profile: profile.id, version: profile.version, passed: errors.length === 0, errors })
  }
  const passed = results.every(x => x.passed)
  console.log(JSON.stringify({ schema: 'ppl.profile-validation-suite/0.2', passed, results }, null, 2))
  process.exit(passed ? 0 : 1)
}

if (command === 'simulate' || command === 'export-app') {
  const profile = await load(args[0])
  const scenario = await load(args[1])
  const result = runProfileScenario(profile, scenario)
  console.log(JSON.stringify(command === 'export-app' ? toAppSession(profile, result) : result, null, 2))
  process.exit(0)
}

if (command === 'inspect-assistments') {
  const text = await readFile(resolve(args[0]), 'utf8')
  console.log(JSON.stringify({ schema: 'ppl.tutor/assistments-inspection/0.1', passed: true, summary: summarizeAssistmentsCsv(text) }, null, 2))
  process.exit(0)
}

if (command === 'import-assistments') {
  const csv = args[0]
  const text = await readFile(resolve(csv), 'utf8')
  const options = {
    userId: flagValue(args, '--user'),
    skillId: flagValue(args, '--skill'),
    maxRows: flagValue(args, '--max'),
    originalOnly: args.includes('--original-only'),
  }
  const scenario = assistmentsCsvToScenario(text, options)
  const out = flagValue(args, '--out')
  const json = `${JSON.stringify(scenario, null, 2)}\n`
  if (out) {
    await writeFile(resolve(out), json)
    console.log(JSON.stringify({ schema: 'ppl.tutor/assistments-import/0.1', passed: true, output: resolve(out), sourceRows: scenario.source.selection.sourceRows, selectedRows: scenario.source.selection.selectedRows }, null, 2))
  } else console.log(json.trimEnd())
  process.exit(0)
}


if (command === 'replay-assistments') {
  const csv = args[0]
  const text = await readFile(resolve(csv), 'utf8')
  const profile = await load('profiles/tutor/profile.json')
  const options = {
    userId: flagValue(args, '--user'),
    skillId: flagValue(args, '--skill'),
    maxRows: flagValue(args, '--max'),
    originalOnly: args.includes('--original-only'),
    id: `assistments-replay-${flagValue(args, '--user') || 'selected'}`,
  }
  const scenario = assistmentsCsvToScenario(text, options)
  const result = runProfileScenario(profile, scenario)
  const payload = args.includes('--app') ? toAppSession(profile, result) : result
  const out = flagValue(args, '--out')
  const json = `${JSON.stringify(payload, null, 2)}
`
  if (out) {
    await writeFile(resolve(out), json)
    console.log(JSON.stringify({ schema: 'ppl.tutor/assistments-replay/0.1', passed: true, output: resolve(out), selectedRows: scenario.source.selection.selectedRows, finalState: result.finalState.learner?.skills?.[result.finalState.learner?.currentSkillKey] }, null, 2))
  } else console.log(json.trimEnd())
  process.exit(0)
}

usage()
process.exit(2)
