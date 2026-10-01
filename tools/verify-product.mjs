#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const checks = []
function run(label, command, args, cwd = root) {
  if(command==='node')command=process.execPath
  else if(command==='npm'&&process.env.npm_execpath){args=[process.env.npm_execpath,...args];command=process.execPath}
  else if(command==='npm'&&process.platform==='win32'){args=['/d','/s','/c',`npm ${args.join(' ')}`];command=process.env.ComSpec||'cmd.exe'}
  const started=Date.now()
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, NODE_NO_WARNINGS: '1' } })
  const count = result.stdout?.match(/^# tests (\d+)$/m)
  const pass = result.stdout?.match(/^# pass (\d+)$/m)
  const skip = result.stdout?.match(/^# skipped (\d+)$/m)
  checks.push({ label, passed: result.status === 0, durationMs: Date.now()-started, ...(count?{tests:Number(count[1]),pass:Number(pass?.[1]||0),skipped:Number(skip?.[1]||0)}:{}) })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if(result.error)process.stderr.write(String(result.error)+'\n')
    console.error(JSON.stringify({schema:'ppl.product-verify/5',version:'1.0.0-dev.5',passed:false,checks},null,2))
    throw new Error(`${label} failed`)
  }
}

const required = [
  'package.json', 'package-lock.json', 'INSTALL_PRODUCT.sh',
  'platform/core/src/store.mjs', 'platform/core/src/repositories.mjs',
  'platform/execution/src/index.mjs', 'platform/execution/src/transports.mjs', 'platform/execution/src/retrieval.mjs',
  'product/agent-governance/package.json',
  'product/research-governance/package.json',
  'product/tutor-governance/package.json',
  'product/life-governance/package.json',
  'product/character-governance/package.json',
  'product/platform-gateway/package.json',
  'product/observatory/public/index.html', 'product/observatory/public/app.mjs',
  'product/observatory/src/read-model.mjs', 'tools/r3-observatory-smoke.mjs',
  'tools/r4-qualify-execution.mjs', 'platform/execution/src/json-contract.mjs', 'tools/qualification/runner.mjs',
  'manifest/product/PRODUCT_SURFACE.json',
  'manifest/product/MIGRATION_PLAN.json',
]
for (const rel of required) if (!fs.existsSync(path.join(root, rel))) throw new Error(`missing product file: ${rel}`)
checks.push({ label: 'product-surface-files', passed: true })

run('stable-project-integrity', 'node', ['tools/verify-project.mjs'])
run('stable-component-identity', 'node', ['tools/verify-stable-component-identity.mjs'])
run('mag-regression', 'node', ['--test', 'tests/*.test.mjs'], path.join(root, 'components/governance/multi-agent-governance'))
run('host-offline-install', 'npm', ['ci','--offline','--ignore-scripts','--no-audit','--no-fund'], path.join(root, 'components/application/host'))
run('host-regression', 'npm', ['test'], path.join(root, 'components/application/host'))
run('local-provider-regression', 'npm', ['test'], path.join(root, 'components/infrastructure/provider-local'))
run('native-judge-regression', 'npm', ['test'], path.join(root, 'components/infrastructure/judge-lmstudio-native'))
run('platform-core-tests', 'npm', ['test'], path.join(root, 'platform/core'))
run('observatory-tests','npm',['test'],path.join(root,'product/observatory'))
run('platform-execution-tests', 'npm', ['test'], path.join(root, 'platform/execution'))
for (const product of ['agent-governance','research-governance','tutor-governance','life-governance','character-governance','platform-gateway']) {
  run(`${product}-tests`, 'npm', ['test'], path.join(root, 'product', product))
}
for (const product of ['agent-governance','research-governance','tutor-governance','life-governance','character-governance']) {
  run(`${product}-demo`, 'npm', ['run', 'demo'], path.join(root, 'product', product))
}
run('multi-vertical-sqlite-smoke', 'node', ['tools/product-suite-smoke.mjs'])
run('r2-http-execution-smoke', 'node', ['tools/r2-http-execution-smoke.mjs'])
run('r4-qualification-tests', 'node', ['--test','tools/tests/r4-qualification.test.mjs'])
run('r4-qualification-http-smoke', 'node', ['tools/r4-qualification-smoke.mjs'])
run('r3-observatory-http-restart-smoke', 'node', ['tools/r3-observatory-smoke.mjs'])
console.log(JSON.stringify({ schema: 'ppl.product-verify/5', version: '1.0.0-dev.5', passed: true, checks }, null, 2))
