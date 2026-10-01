import { createProductStore } from '@ppl/platform-core'
import { createAgentGovernanceServer } from '../src/server.mjs'
const store = createProductStore({ filePath: process.env.PPL_DB })
const { server } = createAgentGovernanceServer({ store })
const host = process.env.PPL_HOST || '127.0.0.1'; const port = Number(process.env.PPL_PORT || 8791)
server.listen(port, host, () => console.log(`PPL Agent Governance listening on http://${host}:${port}`))
process.on('SIGINT', () => { server.close(); store.close(); process.exit(0) })
