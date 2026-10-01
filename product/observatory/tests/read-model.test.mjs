import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MemoryRecordStore, SqliteRecordStore } from '@ppl/platform-core'
import { createPlatformRuntime } from '../../platform-gateway/src/index.mjs'
import { ObservatoryReadModel, paginate, redact, storedExecution } from '../src/index.mjs'
import { createFixtureRuntime, seedFixtureRuntime } from '../../../tools/fixtures/r3-runtime.mjs'
import { defaultAgentInput, parseRoute, routeHash, statusInfo, safeExternalUrl } from '../public/ui-model.mjs'

const seeded = async store => seedFixtureRuntime(createFixtureRuntime(store || new MemoryRecordStore()))

test('five application namespaces remain independent even for the same session id', () => {
  const runtime=createPlatformRuntime({store:new MemoryRecordStore()})
  runtime.agent.createSession({sessionId:'same',...defaultAgentInput()})
  runtime.research.createSession({sessionId:'same',question:'research'})
  runtime.tutor.createSession({sessionId:'same',skillId:'fractions.addition'})
  runtime.life.createSession({sessionId:'same'})
  runtime.character.createSession({sessionId:'same'})
  const view=new ObservatoryReadModel(runtime), list=view.sessions()
  assert.equal(list.total,5);assert.equal(new Set(list.items.map(x=>x.app)).size,5)
  for(const app of ['agent','research','tutor','life','character'])assert.equal(view.detail(app,'same').domain.kind,app)
})

test('session lists reflect the latest execution block without rewriting the domain status', async () => {
  const runtime=await seeded(), view=new ObservatoryReadModel(runtime)
  const d=view.detail('research','research-fixture-erasure')
  assert.equal(d.displayStatus,'blocked-analyst-fidelity')
  assert.equal(d.session.status,'evidence-ready')
  assert.equal(view.sessions({app:'research',status:'blocked-analyst-fidelity'}).items[0].sessionId,'research-fixture-erasure')
})

test('observation reads and export do not mutate canonical records or invoke a provider', async () => {
  const runtime=await seeded(), view=new ObservatoryReadModel(runtime)
  const before=runtime.store.get('sessions:research','research-fixture-delivered')
  runtime.researchExecution.run=()=>{throw new Error('read must not execute')}
  view.status();view.sessions();view.detail('research',before.id);view.audit('research',before.id);view.executions('research',before.id);view.export('research',before.id)
  assert.deepEqual(runtime.store.get('sessions:research',before.id),before)
})

test('SQLite restart without configured transports preserves all four execution histories', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppl-r3-restart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const file=path.join(dir,'ppl.sqlite'); const first=await seeded(new SqliteRecordStore(file)); first.store.close()
  const runtime=createPlatformRuntime({store:new SqliteRecordStore(file)});t.after(()=>runtime.store.close())
  const view=new ObservatoryReadModel(runtime)
  assert.equal(view.status().execution.research.configured,false)
  assert.equal(view.status().execution.agent.configured,false)
  for(const name of ['delivered','erasure','judge-reject'])assert.equal(view.executions('research',`research-fixture-${name}`).total,1)
  const agent=view.execution('agent','agent-fixture-tools','fixture-run-tools')
  assert.equal(agent.toolResults.length,1);assert.equal(agent.toolResults[0].provenance.hostOwned,true)
})

test('unknown applications, missing sessions and cross-session run ids fail closed',async()=>{
  const runtime=await seeded(), view=new ObservatoryReadModel(runtime)
  assert.throws(()=>view.detail('admin','x'),/unknown application/)
  assert.throws(()=>view.executions('research','absent'),/unknown session/)
  assert.throws(()=>storedExecution(runtime,'research','research-fixture-erasure','fixture-run-delivered'),/not found/)
  assert.throws(()=>storedExecution(runtime,'tutor','tutor-fixture','fixture-run-tools'),/not found/)
})

test('bounded pagination handles empty lists, search and overflow without inventing counts',async()=>{
  assert.deepEqual(paginate([]),{items:[],total:0,limit:25,offset:0,hasMore:false})
  assert.equal(paginate([1,2,3],{limit:1,offset:1}).items[0],2)
  assert.deepEqual(paginate([1],{offset:99}).items,[])
  for(const limit of [0,-1,1.5,101,'wat',''])assert.throws(()=>paginate([],{limit}))
  for(const offset of [-1,1.5,'wat'])assert.throws(()=>paginate([],{offset}))
  const view=new ObservatoryReadModel(await seeded())
  assert.equal(view.sessions({app:'research',q:'[judge-reject]'}).total,1)
  assert.equal(view.sessions({app:'research',limit:1}).hasMore,true)
})

test('credential redaction covers nested keys, bearer values, URLs and serialized provider JSON',()=>{
  const input={api_key:'top-secret',nested:{Authorization:'Bearer private.token',password:'pwd',tokenUsage:120},url:'https://user:pass@example.test/path?api_key=qsecret&normal=ok',output:'{"apiKey":"embedded-secret","claims":[]}',bindingId:'safe-id'}
  const before=structuredClone(input), result=redact(input), serialized=JSON.stringify(result)
  for(const secret of ['top-secret','private.token','qsecret','embedded-secret','user:pass','pwd'])assert.ok(!serialized.includes(secret))
  assert.equal(result.nested.tokenUsage,120);assert.equal(result.bindingId,'safe-id');assert.deepEqual(input,before)
})

test('exports identify diagnostic scope and retain both material evidence polarities',async()=>{
  const view=new ObservatoryReadModel(await seeded()), data=view.export('research','research-fixture-delivered')
  assert.equal(data.schema,'ppl.observatory.export/1');assert.match(data.warning,/business data/)
  assert.deepEqual(new Set(data.detail.session.context.claims.map(x=>x.polarity)),new Set(['support','oppose']))
  assert.equal(data.executions[0].delivery.finalized.judgeResult.pass,true)
})

test('fixture readiness never claims external qualification and disabled providers stay explicit',()=>{
  const local=new ObservatoryReadModel(createPlatformRuntime({store:new MemoryRecordStore()})).status()
  const demo=new ObservatoryReadModel(createFixtureRuntime(new MemoryRecordStore())).status()
  assert.equal(local.mode,'local');assert.equal(local.execution.research.configured,false)
  assert.equal(demo.mode,'fixture');assert.equal(demo.qualification.externalLiveQualified,false)
})

test('audit filtering preserves original sequence numbers and event data',async()=>{
  const view=new ObservatoryReadModel(await seeded())
  const all=view.audit('research','research-fixture-erasure',{limit:100})
  const filtered=view.audit('research','research-fixture-erasure',{type:'fidelity.blocked'})
  assert.equal(filtered.total,1);assert.equal(filtered.items[0].seq,all.items.find(x=>x.type==='fidelity.blocked').seq)
  assert.ok(filtered.items[0].data.findings.some(f=>f.code==='COUNTER_EVIDENCE_ERASURE'))
})

test('route state encodes slash / unicode session ids and rejects unknown app keys',()=>{
  assert.deepEqual(parseRoute(routeHash('research','共享/a?#','audit')),{app:'research',sessionId:'共享/a?#',tab:'audit'})
  assert.equal(parseRoute('#app=__proto__').app,'research')
  assert.equal(parseRoute('#tab=bogus').tab,'overview')
})

test('links reject active schemes and credential-bearing URLs; statuses do not hide failures',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,x','file:///secret','https://user:pass@host/','/local'])assert.equal(safeExternalUrl(url),null)
  assert.equal(safeExternalUrl('https://example.test/source'),'https://example.test/source')
  assert.equal(statusInfo('blocked-analyst-fidelity').tone,'bad');assert.equal(statusInfo('model-contract-invalid').tone,'bad')
  assert.equal(statusInfo('delivered').tone,'good');assert.equal(statusInfo('evidence-ready').tone,'neutral')
})
