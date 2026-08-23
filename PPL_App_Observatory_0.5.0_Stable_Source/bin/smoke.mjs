import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const port = 43173
const child = spawn(process.execPath, ['packages/app-standalone/server.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stderr = ''
child.stderr.on('data', chunk => { stderr += chunk })
try {
  let ok = false
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) { ok = true; break }
    } catch {}
    await sleep(100)
  }
  if (!ok) throw new Error(`server did not start: ${stderr}`)
  const urls = [
    '/',
    '/modules/app-ui/styles.css',
    '/modules/app-ui/index.mjs',
    '/modules/app-core/index.mjs',
    '/src/app.mjs',
    '/sample/tutor-application-cycle.app-session.json',
    '/sample/research-application-cycle.app-session.json',
    '/sample/tutor-assistments-70363-number-line.app-session.json',
    '/sample/research-ligo-strong-validation.app-session.json',
    '/sample/research-ego-evidence-flip.app-session.json',
    '/sample/research-ego-strong-refutation.app-session.json',
  ]
  const results = []
  for (const path of urls) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`)
    results.push({ path, status: response.status, ok: response.ok })
    if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`)
  }
  const traversal = await fetch(`http://127.0.0.1:${port}/..%2Fpackage.json`)
  results.push({ path: '/../package.json', status: traversal.status, ok: traversal.status === 404 })
  if (traversal.status !== 404) throw new Error(`path traversal guard -> HTTP ${traversal.status}`)
  console.log(JSON.stringify({ schema: 'ppl.app/standalone-smoke/0.1', passed: true, results }, null, 2))
} finally {
  child.kill('SIGTERM')
}
