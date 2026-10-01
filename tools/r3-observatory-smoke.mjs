import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { SqliteRecordStore } from '@ppl/platform-core'
import { createPlatformGateway, createPlatformRuntime } from '../product/platform-gateway/src/index.mjs'
import { createFixtureRuntime, seedFixtureRuntime } from './fixtures/r3-runtime.mjs'

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppl-r3-smoke-'))
const file=path.join(dir,'demo.sqlite')
let server, runtime
try {
  runtime=await seedFixtureRuntime(createFixtureRuntime(new SqliteRecordStore(file)))
  ;({server}=createPlatformGateway({runtime}));server.listen(0,'127.0.0.1');await once(server,'listening')
  let base=`http://127.0.0.1:${server.address().port}`
  const get=async pathname=>{const response=await fetch(base+pathname);assert.equal(response.status,200);return response.json()}
  assert.equal((await fetch(base+'/')).status,200)
  assert.equal((await get('/v1/observatory/sessions')).total,7)
  const erasure=await get('/v1/observatory/apps/research/sessions/research-fixture-erasure')
  assert.equal(erasure.displayStatus,'blocked-analyst-fidelity')
  const rejected=await get('/v1/observatory/apps/research/sessions/research-fixture-judge-reject/executions/fixture-run-judge-reject')
  assert.equal(rejected.delivery.finalized.judgeResult.pass,false)
  await new Promise(resolve=>server.close(resolve));runtime.store.close()
  runtime=createPlatformRuntime({store:new SqliteRecordStore(file)})
  ;({server}=createPlatformGateway({runtime}));server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`
  assert.equal((await get('/v1/observatory/status')).execution.research.configured,false)
  const exported=await get('/v1/observatory/apps/research/sessions/research-fixture-delivered/export')
  assert.equal(exported.executions[0].status,'delivered')
  const tools=await get('/v1/agent/sessions/agent-fixture-tools/executions')
  assert.equal(tools.executions[0].toolResults.length,1)
  console.log(JSON.stringify({schema:'ppl.r3-observatory-smoke/1',passed:true,fixtureSessions:7,researchDelivered:true,counterEvidenceErasureBlocked:true,semanticJudgeRejectBlocked:true,hostOwnedToolVisible:true,sqliteRestartOfflineRead:true,externalLiveQualified:false},null,2))
} finally {
  if(server?.listening)await new Promise(resolve=>server.close(resolve))
  runtime?.store?.close();fs.rmSync(dir,{recursive:true,force:true})
}
