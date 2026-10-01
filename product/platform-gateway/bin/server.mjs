import { createExecutionDependenciesFromEnv } from '@ppl/platform-execution'
import { createPlatformGateway } from '../src/index.mjs'

const host = process.env.PPL_HOST || '127.0.0.1'
const port = Number(process.env.PPL_PORT || 8787)
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('R3 is an unauthenticated local-owner console; PPL_HOST must be loopback. Remote/multi-user deployment is not supported.')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PPL_PORT must be between 1 and 65535')
const executionDependencies = createExecutionDependenciesFromEnv(process.env)
const { server, runtime } = createPlatformGateway({ storeOptions: { filePath: process.env.PPL_DB }, executionDependencies })
server.listen(port, host, () => {
  console.log(`PPL Observatory: http://${host === '::1' ? '[::1]' : host}:${port}/`)
  console.log(`Local-owner development console; no authentication. Execution: agent=${Boolean(runtime.agentExecution)} research=${Boolean(runtime.researchExecution)}`)
})
let closing = false
function shutdown() {
  if (closing) return; closing = true
  server.close(() => { runtime.store.close(); process.exit(0) })
  // Do not close SQLite while active handlers may still need to persist an execution result.
  const timeout = setTimeout(() => { console.error('Shutdown timed out; in-progress executions may be incomplete.'); process.exit(1) }, 30000)
  timeout.unref()
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
server.on('error', error => { console.error(error.message); runtime.store.close(); process.exitCode = 1 })
