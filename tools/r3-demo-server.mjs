import path from 'node:path'
import { SqliteRecordStore } from '@ppl/platform-core'
import { createPlatformGateway } from '../product/platform-gateway/src/index.mjs'
import { createFixtureRuntime, seedFixtureRuntime } from './fixtures/r3-runtime.mjs'

// Separate store from normal npm start. No keys or external endpoints are consulted.
const filePath = process.env.PPL_DEMO_DB || path.resolve('var/ppl-observatory-demo.sqlite')
const port = Number(process.env.PPL_DEMO_PORT || 8788)
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PPL_DEMO_PORT must be between 0 and 65535')
const store = new SqliteRecordStore(filePath)
const runtime = await seedFixtureRuntime(createFixtureRuntime(store))
const { server } = createPlatformGateway({runtime})
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({schema:'ppl.observatory-demo-ready/1',url:`http://127.0.0.1:${server.address().port}/`,mode:'fixture',database:filePath,externalLiveQualified:false}))
})
let closing=false
function stop(){if(closing)return;closing=true;server.close(()=>{store.close();process.exit(0)});setTimeout(()=>process.exit(1),30000).unref()}
process.on('SIGINT',stop);process.on('SIGTERM',stop)
server.on('error',error=>{console.error(error.message);store.close();process.exitCode=1})
