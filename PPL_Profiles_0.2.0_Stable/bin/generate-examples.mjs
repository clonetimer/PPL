import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { toAppSession } from '../packages/profile-core/src/index.mjs'
import { runProfileScenario } from '../packages/profile-runtime/src/index.mjs'

const pairs = [
  ['character', 'relationship-cycle'],
  ['tutor', 'application-cycle'],
  ['research', 'application-cycle'],
  ['life', 'service-cycle'],
]
await mkdir(resolve('examples/generated'), { recursive: true })
for (const [kind, scenarioName] of pairs) {
  const profile = JSON.parse(await readFile(resolve(`profiles/${kind}/profile.json`), 'utf8'))
  const scenario = JSON.parse(await readFile(resolve(`profiles/${kind}/scenarios/${scenarioName}.json`), 'utf8'))
  const result = runProfileScenario(profile, scenario)
  await writeFile(resolve(`examples/generated/${kind}-${scenarioName}.result.json`), JSON.stringify(result, null, 2) + '\n')
  await writeFile(resolve(`examples/generated/${kind}-${scenarioName}.app-session.json`), JSON.stringify(toAppSession(profile, result), null, 2) + '\n')
}
console.log(JSON.stringify({ schema: 'ppl.profiles/example-generation/0.2', passed: true, generated: pairs.length * 2 }, null, 2))
