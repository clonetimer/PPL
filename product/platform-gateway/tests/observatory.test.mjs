import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { MemoryRecordStore } from '@ppl/platform-core'
import { createPlatformGateway, createPlatformRuntime } from '../src/index.mjs'
import { createFixtureRuntime, seedFixtureRuntime } from '../../../tools/fixtures/r3-runtime.mjs'

async function setup(t, options={}) {
  const runtime=options.runtime || createPlatformRuntime({store:new MemoryRecordStore(),...options})
  const {server}=createPlatformGateway({runtime});server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections()}))
  const base=`http://127.0.0.1:${server.address().port}`
  const get=async url=>{const r=await fetch(base+url);return {status:r.status,body:await r.json(),headers:r.headers}}
  const post=async(url,body={},headers={})=>{const r=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
  return {base,server,runtime,get,post}
}
const detail='/v1/observatory/apps/research/sessions/research-fixture-delivered'

test('UI assets are offline, whitelist-only, same-origin and carry browser security headers',async t=>{
  const {base}=await setup(t)
  for(const [url,type] of [['/','text/html'],['/observatory/','text/html'],['/observatory/app.mjs','text/javascript'],['/observatory/ui-model.mjs','text/javascript'],['/observatory/style.css','text/css']]){
    const response=await fetch(base+url);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith(type))
    const csp=response.headers.get('content-security-policy');assert.match(csp,/script-src 'self'/);assert.match(csp,/frame-ancestors 'none'/);assert.ok(!csp.includes('unsafe-inline'))
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cache-control'),'no-store')
  }
  const head=await fetch(base+'/observatory/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'')
  for(const url of ['/observatory/../../README.md','/observatory/%2e%2e/%2e%2e/.env','/observatory/%2f..%2f.env','/observatory/src/server.mjs','/.env','/package.json'])assert.equal((await fetch(base+url)).status,404)
})

test('status and session views show fixture provenance, finding codes, judge decision and tool result',async t=>{
  const runtime=await seedFixtureRuntime(createFixtureRuntime(new MemoryRecordStore()))
  const {get}=await setup(t,{runtime})
  assert.equal((await get('/v1/observatory/status')).body.mode,'fixture')
  const session=await get(detail);assert.equal(session.status,200);assert.equal(session.body.counts.claims,2)
  const run=await get(detail+'/executions/fixture-run-delivered');assert.equal(run.body.delivery.finalized.judgeResult.pass,true)
  const bad=await get('/v1/observatory/apps/research/sessions/research-fixture-erasure/executions/fixture-run-erasure')
  assert.ok(bad.body.analyst.fidelity.findings.some(x=>x.code==='COUNTER_EVIDENCE_ERASURE'))
  const tools=await get('/v1/observatory/apps/agent/sessions/agent-fixture-tools/executions/fixture-run-tools')
  assert.equal(tools.body.toolResults.length,1)
})

test('read-only projection rejects writes and invalid pagination without changing session revision',async t=>{
  const {runtime,get,post}=await setup(t)
  runtime.research.createSession({sessionId:'s',question:'q'})
  const before=runtime.store.get('sessions:research','s')
  assert.equal((await post('/v1/observatory/apps/research/sessions/s',{})).status,405)
  for(const suffix of ['?limit=0','?limit=101','?offset=-1','?limit=abc'])assert.equal((await get('/v1/observatory/sessions'+suffix)).status,400)
  assert.equal((await get('/v1/observatory/apps/nope/sessions/s')).status,404)
  assert.equal((await get('/v1/observatory/apps/research/sessions/absent')).status,404)
  assert.deepEqual(runtime.store.get('sessions:research','s'),before)
})

test('legacy execution read API works with providers disabled and rejects cross-session runs',async t=>{
  const runtime=await seedFixtureRuntime(createFixtureRuntime(new MemoryRecordStore()))
  runtime.researchExecution=null;runtime.agentExecution=null
  const {get,post}=await setup(t,{runtime})
  assert.equal((await get('/v1/research/sessions/research-fixture-delivered/executions')).body.executions.length,1)
  assert.equal((await get('/v1/agent/sessions/agent-fixture-tools/executions')).body.executions.length,1)
  assert.equal((await get('/v1/research/sessions/research-fixture-erasure/executions/fixture-run-delivered')).status,404)
  assert.equal((await get('/v1/research/sessions/missing/executions')).status,404)
  assert.equal((await get('/v1/research/sessions/research-fixture-delivered/executions/missing')).status,404)
  assert.equal((await post('/v1/research/sessions/research-fixture-delivered/execute')).status,503)
})

test('same-origin JSON writes are accepted, hostile Origin and cross-site requests are not',async t=>{
  const {base,post}=await setup(t)
  assert.equal((await post('/v1/life/sessions',{sessionId:'ok'},{origin:base})).status,201)
  assert.equal((await post('/v1/life/sessions',{sessionId:'bad'},{origin:'https://evil.example'})).status,403)
  assert.equal((await post('/v1/life/sessions',{sessionId:'null'},{origin:'null'})).status,403)
  assert.equal((await post('/v1/life/sessions',{sessionId:'cross'},{'sec-fetch-site':'cross-site'})).status,403)
  assert.equal((await fetch(base+'/v1/life/sessions',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'})).status,415)
})

test('host validation rejects DNS rebinding-style Host headers before exposing data',async t=>{
  const {base}=await setup(t)
  const response=await new Promise((resolve,reject)=>{const req=http.get(base+'/v1/observatory/status',{headers:{host:'attacker.example'}},res=>{res.resume();res.on('end',()=>resolve(res))});req.on('error',reject)})
  assert.equal(response.statusCode,403)
})

test('bounded JSON ingress returns 413 and invalid JSON bodies fail without creating sessions',async t=>{
  const {base,get}=await setup(t)
  const large=await fetch(base+'/v1/life/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:'x'.repeat(1024*1024)})})
  assert.equal(large.status,413)
  for(const body of ['{','null','[]','"string"'])assert.equal((await fetch(base+'/v1/life/sessions',{method:'POST',headers:{'content-type':'application/json'},body})).status,400)
  assert.equal((await get('/v1/life/sessions')).body.sessions.length,0)
})

test('chunked oversized bodies receive HTTP 413 rather than growing an unbounded JSON buffer',async t=>{
  const {base}=await setup(t)
  const code=await new Promise((resolve,reject)=>{
    const req=http.request(base+'/v1/life/sessions',{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))})
    req.on('error',reject);req.write('{"data":"');for(let i=0;i<20;i++)req.write('x'.repeat(65536));req.end('"}')
  })
  assert.equal(code,413)
})

test('strict legacy routes reject trailing path confusion and malformed URI encoding',async t=>{
  const {base,runtime,get,post}=await setup(t)
  runtime.research.createSession({sessionId:'s',question:'q'})
  assert.equal((await post('/v1/research/sessions/s/claims/extra',{canonicalText:'bad'})).status,404)
  assert.equal((await get('/v1/research/sessions/s/audit/extra')).status,404)
  assert.equal((await fetch(base+'/v1/research/sessions/%E0%A4%A')).status,400)
  assert.equal(runtime.research.getEvidence('s').length,0)
})

test('export redacts credentials, has attachment semantics and leaves original record untouched',async t=>{
  const {runtime,get}=await setup(t)
  runtime.research.createSession({sessionId:'private',question:'q',metadata:{apiKey:'do-not-export',headers:{authorization:'Bearer local-secret'}}})
  const response=await get('/v1/observatory/apps/research/sessions/private/export')
  assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/)
  assert.ok(!JSON.stringify(response.body).includes('do-not-export'))
  assert.equal(runtime.research.getSession('private').metadata.apiKey,'do-not-export')
})

test('same-session overlapping execution is rejected and the lock clears after completion',async t=>{
  let release,started
  const startedPromise=new Promise(resolve=>{started=resolve})
  const runtime=createPlatformRuntime({store:new MemoryRecordStore()})
  runtime.research.createSession({sessionId:'s',question:'q'})
  let calls=0
  runtime.researchExecution={run:async()=>{calls++;started();return new Promise(resolve=>{release=()=>resolve({status:'completed'})})}}
  const {post}=await setup(t,{runtime})
  const first=post('/v1/research/sessions/s/execute');await startedPromise
  const duplicate=await post('/v1/research/sessions/s/execute');assert.equal(duplicate.status,409);assert.equal(duplicate.body.code,'EXECUTION_IN_PROGRESS')
  release();assert.equal((await first).status,200);assert.equal(calls,1)
  runtime.researchExecution.run=async()=>({status:'completed'})
  assert.equal((await post('/v1/research/sessions/s/execute')).status,200)
})

test('execution lock clears after a rejected executor',async t=>{
  const runtime=createPlatformRuntime({store:new MemoryRecordStore()});runtime.research.createSession({sessionId:'s',question:'q'})
  runtime.researchExecution={run:async()=>{throw new Error('fixture failure')}}
  const {post}=await setup(t,{runtime})
  assert.equal((await post('/v1/research/sessions/s/execute')).status,400)
  runtime.researchExecution.run=async()=>({status:'completed'})
  assert.equal((await post('/v1/research/sessions/s/execute')).status,200)
})
