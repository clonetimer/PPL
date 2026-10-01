import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRecordStore } from '@ppl/platform-core'
import { createScriptedTransport } from '@ppl/platform-execution'
import { AgentGovernanceService } from '../src/agent-service.mjs'
import { AgentExecutionService } from '../src/execution-service.mjs'

const contracts=[
 {schema:'ppl.multi-agent.agent-contract/0.1',agentId:'source',role:'source',authorityScopes:['work:evidence'],capabilities:['handoff'],tools:[],delegation:{allowedTargets:['target'],maxDepth:2,transferableAuthorityScopes:['work:evidence'],allowCycles:false,allowSelfDelegation:false},contextPolicy:{allowedSensitivities:['public','task'],allowedStatePaths:['question'],preserveConflictSets:true}},
 {schema:'ppl.multi-agent.agent-contract/0.1',agentId:'target',role:'target',authorityScopes:['work:evidence'],capabilities:['analyze'],tools:[],delegation:{allowedTargets:[],maxDepth:2,transferableAuthorityScopes:[],allowCycles:false,allowSelfDelegation:false},contextPolicy:{allowedSensitivities:['public','task'],allowedStatePaths:['question'],preserveConflictSets:true}},
]
function session(service,id='s',agentContracts=contracts) { return service.createSession({sessionId:id,agentContracts,context:{schema:'ppl.multi-agent.context/0.1',state:{question:'A vs B?'},claims:[
 {claimId:'support',canonicalText:'Study A supports A.',status:'provisional',polarity:'support',confidence:.7,sourceRefs:['a'],assertedBy:'source',sensitivity:'task',requiredForDecision:true,conflictSetId:'effect',derivedFrom:[],authorityScope:'work:evidence'},
 {claimId:'oppose',canonicalText:'Study B opposes A.',status:'provisional',polarity:'oppose',confidence:.7,sourceRefs:['b'],assertedBy:'source',sensitivity:'task',requiredForDecision:true,conflictSetId:'effect',derivedFrom:[],authorityScope:'work:evidence'}
]}}) }

test('generic execution completes when model preserves canonical claims', async () => {
 const store=new MemoryRecordStore(); const service=new AgentGovernanceService({store}); session(service)
 const model=createScriptedTransport([req=>({schema:'ppl.product.handoff-receiver-response/1',message:'mixed',claims:req.handoff.payload.claims})])
 const exec=new AgentExecutionService({governanceService:service,modelTransport:model,store})
 const out=await exec.executeHandoff('s',{sourceAgentId:'source',targetAgentId:'target',requestedCapabilities:['analyze'],requestedAuthorityScopes:['work:evidence'],transform:{mode:'structured-summary',summary:'analyze'}})
 assert.equal(out.status,'completed'); assert.equal(out.fidelity.hardGatePassed,true)
})

test('generic execution blocks counter-evidence erasure by model', async () => {
 const store=new MemoryRecordStore(); const service=new AgentGovernanceService({store}); session(service)
 const model=createScriptedTransport([req=>({schema:'ppl.product.handoff-receiver-response/1',message:'A wins',claims:req.handoff.payload.claims.filter(c=>c.polarity!=='oppose')})])
 const exec=new AgentExecutionService({governanceService:service,modelTransport:model,store})
 const out=await exec.executeHandoff('s',{sourceAgentId:'source',targetAgentId:'target',requestedCapabilities:['analyze'],requestedAuthorityScopes:['work:evidence'],transform:{mode:'structured-summary',summary:'analyze'}})
 assert.equal(out.status,'blocked-by-fidelity')
 assert.ok(out.fidelity.findings.some(x=>x.code==='COUNTER_EVIDENCE_ERASURE'))
})

test('host owns allowlisted tool execution and continues model after tool result', async () => {
 const store=new MemoryRecordStore()
 const toolContracts=[
  {...contracts[0],tools:['lookup']},
  {...contracts[1],tools:['lookup']},
 ]
 const service=new AgentGovernanceService({store})
 service.createSession({sessionId:'tools',agentContracts:toolContracts,context:{schema:'ppl.multi-agent.context/0.1',state:{question:'A?'},claims:[{claimId:'c',canonicalText:'Canonical fact.',status:'provisional',polarity:'neutral',confidence:.6,sourceRefs:['src'],assertedBy:'source',sensitivity:'task',requiredForDecision:true,conflictSetId:null,derivedFrom:[],authorityScope:'work:evidence'}]}})
 let executions=0
 const model=createScriptedTransport([
  (req,ctx)=>({status:'completed',output:'',toolCalls:[{callId:'call-1',name:'lookup',arguments:{key:'x'}}],providerRequestId:'first',raw:{choices:[{message:{content:'',tool_calls:[{id:'call-1',type:'function',function:{name:'lookup',arguments:'{"key":"x"}'}}]}}]}}),
  req=>({schema:'ppl.product.handoff-receiver-response/1',message:'used host result',claims:JSON.parse(req.transportChatMessages[1].content).handoff.payload.claims}),
 ])
 const exec=new AgentExecutionService({governanceService:service,modelTransport:model,store,tools:[{name:'lookup',description:'host lookup',parameters:{type:'object',additionalProperties:false,required:['key'],properties:{key:{type:'string'}}},execute:async args=>{executions++; return {value:`found:${args.key}`}}}]})
 const out=await exec.executeHandoff('tools',{sourceAgentId:'source',targetAgentId:'target',requestedCapabilities:['analyze'],requestedAuthorityScopes:['work:evidence'],requestedTools:['lookup'],transform:{mode:'structured-summary',summary:'analyze'}})
 assert.equal(out.status,'completed')
 assert.equal(out.toolResults.length,1)
 assert.equal(executions,1)
 assert.equal(out.toolResults[0].provenance.hostOwned,true)
})


test('non-string receiver message is rejected before fidelity assessment',async()=>{
 const store=new MemoryRecordStore(),service=new AgentGovernanceService({store});session(service)
 const model=createScriptedTransport([req=>({schema:'ppl.product.handoff-receiver-response/1',message:{not:'text'},claims:req.handoff.payload.claims})])
 const exec=new AgentExecutionService({governanceService:service,modelTransport:model,store})
 const run=await exec.executeHandoff('s',{sourceAgentId:'source',targetAgentId:'target',requestedCapabilities:['analyze'],requestedAuthorityScopes:['work:evidence'],transform:{mode:'structured-summary',summary:'analyze'}})
 assert.equal(run.status,'model-failed');assert.equal(run.error.contractError,'RESPONSE_CONTRACT_INVALID');assert.equal(run.fidelity,null)
})

test('tool-enabled initial answer with no tool calls still receives full response validation',async()=>{
 const store=new MemoryRecordStore(),service=new AgentGovernanceService({store});session(service,'tools-no-call',contracts.map(c=>({...c,tools:['lookup']})))
 let executions=0
 const model=createScriptedTransport([req=>({schema:'ppl.product.handoff-receiver-response/1',message:123,claims:req.handoff.payload.claims})])
 const exec=new AgentExecutionService({governanceService:service,modelTransport:model,store,tools:[{name:'lookup',parameters:{type:'object',properties:{}},execute:async()=>{executions++;return {ok:true}}}]})
 const run=await exec.executeHandoff('tools-no-call',{sourceAgentId:'source',targetAgentId:'target',requestedCapabilities:['analyze'],requestedAuthorityScopes:['work:evidence'],requestedTools:['lookup'],transform:{mode:'structured-summary',summary:'analyze'}})
 assert.equal(run.status,'model-failed');assert.equal(run.error.contractError,'RESPONSE_CONTRACT_INVALID');assert.equal(executions,0)
})
