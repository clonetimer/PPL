#!/usr/bin/env node
import http from 'node:http'
import { once } from 'node:events'
import { MemoryRecordStore } from '@ppl/platform-core'
import { createOpenAICompatibleChatTransport, createHttpJsonRetrievalProvider } from '@ppl/platform-execution'
import { AgentGovernanceService, AgentExecutionService } from '@ppl/product-agent-governance'
import { ResearchGovernanceService, ResearchExecutionService } from '@ppl/product-research-governance'

function send(res,status,obj){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(obj))}
function requestObject(body){
  const msgs=body.messages||[]
  for(const msg of msgs){ if(msg.role!=='user' || typeof msg.content!=='string') continue; try{ const x=JSON.parse(msg.content); if(x?.schema) return x }catch{} }
  return null
}
const modelServer=http.createServer(async (req,res)=>{
  let raw=''; for await(const c of req) raw+=c
  const body=JSON.parse(raw||'{}'); const request=requestObject(body)
  if(!request) return send(res,400,{error:{message:'missing request'}})
  let value
  if(request.schema==='ppl.product.research-evidence-extraction-request/1') {
    const oppose=String(request.document?.title).includes('B')
    value={schema:'ppl.product.research-evidence-extraction/1',relevant:true,canonicalText:oppose?'HTTP Study B reports no benefit for method A.':'HTTP Study A reports a benefit for method A.',polarity:oppose?'oppose':'support',confidence:.71,rationale:'mock HTTP source interpretation'}
  } else if(request.modelRole==='analyst') {
    const erase=String(request.handoff?.task?.objective||'').includes('ERASURE_CASE')
    value={schema:'ppl.product.handoff-receiver-response/1',message:erase?'Only favorable evidence retained.':'Both sides retained.',claims:erase?request.handoff.payload.claims.filter(c=>c.polarity!=='oppose'):request.handoff.payload.claims}
  } else if(request.modelRole==='reviewer') {
    const reject=String(request.handoff?.task?.objective||'').includes('JUDGE_REJECT_CASE')
    value={schema:'ppl.product.research-review-response/1',derivedConclusion:reject?'Method A is certainly superior.':'The HTTP-fetched evidence is mixed; superiority is not established.',claims:request.handoff.payload.claims}
  } else if(request.modelRole==='bound-delivery-judge') {
    const reject=String(request.objective?.objective||request.objective?.question||'').includes('JUDGE_REJECT_CASE') || String(request.derivedConclusion?.text||'').includes('certainly superior')
    value={schema:'ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1',handoffId:request.handoffId,bindingId:request.bindingId,pass:!reject,counterEvidenceIntegrated:!reject,uncertaintyCalibrated:!reject,attributionPreservation:true,metricScopePreservation:true,conclusionSupported:!reject,noNovelFacts:true,findings:reject?['injected certainty overreach']:[]}
  } else if(request.schema==='ppl.product.agent-execution-request/1') {
    value={schema:'ppl.product.handoff-receiver-response/1',message:'Canonical claims retained over HTTP.',claims:request.handoff.payload.claims}
  } else return send(res,400,{error:{message:`unsupported ${request.schema}/${request.modelRole}`}})
  send(res,200,{id:`http_${Date.now()}`,choices:[{message:{role:'assistant',content:JSON.stringify(value)}}],usage:{prompt_tokens:10,completion_tokens:10}})
})
const retrievalServer=http.createServer(async (req,res)=>{
  let raw=''; for await(const c of req) raw+=c; const body=JSON.parse(raw||'{}')
  send(res,200,{documents:[
    {id:'http-a',title:'Study A',url:'https://example.test/http-a',text:`${body.query}: benefit reported`},
    {id:'http-b',title:'Study B',url:'https://example.test/http-b',text:`${body.query}: replication found no benefit`},
  ]})
})
await new Promise(r=>modelServer.listen(0,'127.0.0.1',r)); await new Promise(r=>retrievalServer.listen(0,'127.0.0.1',r))
try {
  const modelEndpoint=`http://127.0.0.1:${modelServer.address().port}/v1/chat/completions`
  const retrievalEndpoint=`http://127.0.0.1:${retrievalServer.address().port}/retrieve`
  const agentTransport=createOpenAICompatibleChatTransport({preset:'vllm',endpoint:modelEndpoint,model:'mock-agent',independenceGroup:'http-agent'})
  const judgeTransport=createOpenAICompatibleChatTransport({preset:'vllm',endpoint:modelEndpoint,model:'mock-judge',independenceGroup:'http-judge'})
  const retrieval=createHttpJsonRetrievalProvider({endpoint:retrievalEndpoint})
  const store=new MemoryRecordStore()

  const research=new ResearchGovernanceService({store}); research.createSession({sessionId:'http-research',question:'Does method A outperform baseline?'})
  const researchExec=new ResearchExecutionService({researchService:research,retrievalProvider:retrieval,modelTransport:agentTransport,judgeTransport,independenceMode:'required',store})
  const rr=await researchExec.run('http-research',{limit:2})
  if(rr.status!=='delivered') throw new Error(`research HTTP smoke failed: ${rr.status}`)


  research.createSession({sessionId:'http-erasure',question:'ERASURE_CASE: Does method A outperform baseline?'})
  const erased=await researchExec.run('http-erasure',{limit:2})
  if(erased.status!=='blocked-analyst-fidelity' || !erased.analyst?.fidelity?.findings?.some(x=>x.code==='COUNTER_EVIDENCE_ERASURE')) throw new Error(`research HTTP erasure injection was not blocked: ${erased.status}`)

  research.createSession({sessionId:'http-judge-reject',question:'JUDGE_REJECT_CASE: Does method A outperform baseline?'})
  const judgeRejected=await researchExec.run('http-judge-reject',{limit:2})
  if(judgeRejected.status!=='blocked-by-semantic-judge') throw new Error(`research HTTP judge rejection was not blocked: ${judgeRejected.status}`)

  const contracts=[
    {schema:'ppl.multi-agent.agent-contract/0.1',agentId:'a',role:'source',authorityScopes:['scope'],capabilities:['send'],tools:[],delegation:{allowedTargets:['b'],maxDepth:2,transferableAuthorityScopes:['scope'],allowCycles:false,allowSelfDelegation:false},contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true}},
    {schema:'ppl.multi-agent.agent-contract/0.1',agentId:'b',role:'receiver',authorityScopes:['scope'],capabilities:['receive'],tools:[],delegation:{allowedTargets:[],maxDepth:2,transferableAuthorityScopes:[],allowCycles:false,allowSelfDelegation:false},contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true}},
  ]
  const agent=new AgentGovernanceService({store}); agent.createSession({sessionId:'http-agent',agentContracts:contracts,context:{schema:'ppl.multi-agent.context/0.1',state:{topic:'x'},claims:[{claimId:'c',canonicalText:'HTTP canonical fact.',status:'provisional',polarity:'neutral',confidence:.5,sourceRefs:['http'],assertedBy:'a',sensitivity:'task',requiredForDecision:true,conflictSetId:null,derivedFrom:[],authorityScope:'scope'}]}})
  const agentExec=new AgentExecutionService({governanceService:agent,modelTransport:agentTransport,store})
  const ar=await agentExec.executeHandoff('http-agent',{sourceAgentId:'a',targetAgentId:'b',requestedCapabilities:['receive'],requestedAuthorityScopes:['scope'],transform:{mode:'structured-summary',summary:'preserve'}})
  if(ar.status!=='completed') throw new Error(`agent HTTP smoke failed: ${ar.status}`)
  console.log(JSON.stringify({schema:'ppl.r2-http-execution-smoke/2',passed:true,research:{success:{status:rr.status,evidence:rr.extractedClaims.length},erasureInjection:{status:erased.status,blockedCode:'COUNTER_EVIDENCE_ERASURE'},judgeInjection:{status:judgeRejected.status}},agent:{status:ar.status},network:{modelEndpoint,retrievalEndpoint}},null,2))
} finally { modelServer.close(); retrievalServer.close(); await Promise.all([once(modelServer,'close'),once(retrievalServer,'close')]) }
