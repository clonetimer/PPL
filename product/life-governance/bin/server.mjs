import { createProductStore } from '@ppl/platform-core'
import { createLifeGovernanceServer } from '../src/server.mjs'
const store = createProductStore({ filePath: process.env.PPL_DB })
const { server } = createLifeGovernanceServer({ store })
const host = process.env.PPL_HOST || '127.0.0.1'; const port = Number(process.env.PPL_PORT || 8789)
server.listen(port, host, () => console.log(`PPL Life Governance listening on http://${host}:${port}`))
process.on('SIGINT', () => { server.close(); store.close(); process.exit(0) })
