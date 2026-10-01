#!/usr/bin/env node
import { createProductStore } from '@ppl/platform-core'
import { listenResearchGovernanceServer } from '../src/server.mjs'
const store = createProductStore({ filePath: process.env.PPL_DB })
const { server, host, port } = await listenResearchGovernanceServer({ store })
console.log(`PPL Research Governance listening on http://${host}:${port}`)
process.on('SIGINT', () => { server.close(); store.close(); process.exit(0) })
