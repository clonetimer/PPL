import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { MemoryRecordStore } from '@ppl/platform-core'
import { createPlatformGateway } from '../src/index.mjs'

test('gateway exposes all independent verticals and keeps namespaces separate', async t => {
  const { server } = createPlatformGateway({ store: new MemoryRecordStore() })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}`
  const apps = await fetch(`${base}/v1/apps`).then(r => r.json())
  assert.deepEqual(apps.apps.map(x => x.id), ['agent','research','tutor','life','character'])
  const create = async (vertical, body) => fetch(`${base}/v1/${vertical}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
  const contracts = [
    { schema:'ppl.multi-agent.agent-contract/0.1', agentId:'a', role:'source', authorityScopes:['scope'], capabilities:['send'], tools:[], delegation:{allowedTargets:['b'],maxDepth:2,transferableAuthorityScopes:['scope'],allowCycles:false,allowSelfDelegation:false}, contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true} },
    { schema:'ppl.multi-agent.agent-contract/0.1', agentId:'b', role:'receiver', authorityScopes:['scope'], capabilities:['receive'], tools:[], delegation:{allowedTargets:[],maxDepth:2,transferableAuthorityScopes:[],allowCycles:false,allowSelfDelegation:false}, contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true} },
  ]
  const agent = await create('agent', { sessionId: 'same', agentContracts: contracts, context: { schema:'ppl.multi-agent.context/0.1', state:{topic:'x'}, claims:[] } })
  const research = await create('research', { sessionId: 'same', question: 'q' })
  const tutor = await create('tutor', { sessionId: 'same', skillId: 'fractions.addition' })
  const life = await create('life', { sessionId: 'same' })
  const character = await create('character', { sessionId: 'same' })
  assert.equal(agent.sessionId, 'same'); assert.equal(research.sessionId, 'same'); assert.equal(tutor.sessionId, 'same'); assert.equal(life.sessionId, 'same'); assert.equal(character.sessionId, 'same')
})

import { createCallbackTransport, createStaticRetrievalProvider } from '@ppl/platform-execution'

test('gateway routes governed agent and research execution to their independent executors', async t => {
  const modelTransport=createCallbackTransport({identity:{provider:'test',model:'agent',independenceGroup:'agent'},invoke:async request=>{
    let value
    if(request.schema==='ppl.product.research-evidence-extraction-request/1') {
      const oppose=String(request.document?.title).includes('B')
      value={schema:'ppl.product.research-evidence-extraction/1',relevant:true,canonicalText:oppose?'Study B reports no benefit.':'Study A reports a benefit.',polarity:oppose?'oppose':'support',confidence:.7,rationale:'fixture'}
    } else if(request.modelRole==='analyst') value={schema:'ppl.product.handoff-receiver-response/1',message:'mixed',claims:request.handoff.payload.claims}
    else if(request.modelRole==='reviewer') value={schema:'ppl.product.research-review-response/1',derivedConclusion:'Evidence is mixed; benefit is not established.',claims:request.handoff.payload.claims}
    else value={schema:'ppl.product.handoff-receiver-response/1',message:'preserved',claims:request.handoff.payload.claims}
    return {status:'completed',output:JSON.stringify(value),toolCalls:[]}
  }})
  const judgeTransport=createCallbackTransport({identity:{provider:'test',model:'judge',independenceGroup:'judge'},invoke:async request=>({status:'completed',output:JSON.stringify({schema:'ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1',handoffId:request.handoffId,bindingId:request.bindingId,pass:true,counterEvidenceIntegrated:true,uncertaintyCalibrated:true,attributionPreservation:true,metricScopePreservation:true,conclusionSupported:true,noNovelFacts:true,findings:[]}),toolCalls:[]})})
  const retrievalProvider=createStaticRetrievalProvider([
    {id:'a',title:'Study A',url:'https://example.test/a',text:'benefit'},
    {id:'b',title:'Study B',url:'https://example.test/b',text:'no benefit'},
  ])
  const {server}=createPlatformGateway({store:new MemoryRecordStore(),executionDependencies:{enabled:true,modelTransport,judgeTransport,retrievalProvider,independenceMode:'required',summary:{enabled:true}}})
  server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(()=>server.close())
  const base=`http://127.0.0.1:${server.address().port}`
  const json=async (url,method='GET',body)=>{ const r=await fetch(base+url,{method,headers:{'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})}); return {status:r.status,body:await r.json()} }
  const health=await json('/health'); assert.equal(health.body.execution.agent,true); assert.equal(health.body.execution.research,true)
  await json('/v1/research/sessions','POST',{sessionId:'rx',question:'Does A help?'})
  const researchRun=await json('/v1/research/sessions/rx/execute','POST',{limit:2})
  assert.equal(researchRun.status,200); assert.equal(researchRun.body.status,'delivered')
  const researchRuns=await json('/v1/research/sessions/rx/executions'); assert.equal(researchRuns.status,200); assert.equal(researchRuns.body.executions.length,1); assert.equal(researchRuns.body.executions[0].runId,researchRun.body.runId)

  const contracts=[
    {schema:'ppl.multi-agent.agent-contract/0.1',agentId:'a',role:'source',authorityScopes:['scope'],capabilities:['send'],tools:[],delegation:{allowedTargets:['b'],maxDepth:2,transferableAuthorityScopes:['scope'],allowCycles:false,allowSelfDelegation:false},contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true}},
    {schema:'ppl.multi-agent.agent-contract/0.1',agentId:'b',role:'receiver',authorityScopes:['scope'],capabilities:['receive'],tools:[],delegation:{allowedTargets:[],maxDepth:2,transferableAuthorityScopes:[],allowCycles:false,allowSelfDelegation:false},contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true}},
  ]
  await json('/v1/agent/sessions','POST',{sessionId:'ax',agentContracts:contracts,context:{schema:'ppl.multi-agent.context/0.1',state:{topic:'x'},claims:[{claimId:'c',canonicalText:'fact',status:'provisional',polarity:'neutral',confidence:.5,sourceRefs:['s'],assertedBy:'a',sensitivity:'task',requiredForDecision:true,conflictSetId:null,derivedFrom:[],authorityScope:'scope'}]}})
  const agentRun=await json('/v1/agent/sessions/ax/execute','POST',{sourceAgentId:'a',targetAgentId:'b',requestedCapabilities:['receive'],requestedAuthorityScopes:['scope'],transform:{mode:'structured-summary',summary:'preserve'}})
  assert.equal(agentRun.status,200); assert.equal(agentRun.body.status,'completed')
  const agentRuns=await json('/v1/agent/sessions/ax/executions'); assert.equal(agentRuns.status,200); assert.equal(agentRuns.body.executions.length,1); assert.equal(agentRuns.body.executions[0].runId,agentRun.body.runId)
})
