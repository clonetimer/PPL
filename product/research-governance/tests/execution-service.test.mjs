import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRecordStore } from '@ppl/platform-core'
import { createStaticRetrievalProvider, createScriptedTransport } from '@ppl/platform-execution'
import { ResearchGovernanceService } from '../src/research-governance.mjs'
import { ResearchExecutionService } from '../src/execution-service.mjs'

function extractor() {
 return createScriptedTransport([
  {schema:'ppl.product.research-evidence-extraction/1',relevant:true,canonicalText:'Study A reports a benefit for method A.',polarity:'support',confidence:.72,rationale:'direct comparison'},
  {schema:'ppl.product.research-evidence-extraction/1',relevant:true,canonicalText:'Study B reports no benefit for method A.',polarity:'oppose',confidence:.74,rationale:'direct counter-evidence'},
 ],{model:'extractor'})
}
function retrieval() { return createStaticRetrievalProvider([
 {id:'a',title:'Study A',url:'https://example.test/a',text:'In the benchmark, method A improved the target metric.'},
 {id:'b',title:'Study B',url:'https://example.test/b',text:'A replication found no improvement for method A.'},
]) }
function judgePass() { return createScriptedTransport([req=>({schema:'ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1',handoffId:req.handoffId,bindingId:req.bindingId,pass:true,counterEvidenceIntegrated:true,uncertaintyCalibrated:true,attributionPreservation:true,metricScopePreservation:true,conclusionSupported:true,noNovelFacts:true,findings:[]})],{model:'independent-judge',independenceGroup:'judge'}) }

test('research execution retrieves, extracts, preserves conflict, judges and delivers', async () => {
 const store=new MemoryRecordStore(); const research=new ResearchGovernanceService({store}); research.createSession({sessionId:'r',question:'Does method A outperform the baseline?'})
 const model=createScriptedTransport([
  req=>({schema:'ppl.product.handoff-receiver-response/1',message:'Evidence is mixed.',claims:req.handoff.payload.claims}),
  req=>({schema:'ppl.product.research-review-response/1',derivedConclusion:'The available evidence is mixed; a benefit is not established.',claims:req.handoff.payload.claims}),
 ],{model:'agent',independenceGroup:'agent'})
 const exec=new ResearchExecutionService({researchService:research,retrievalProvider:retrieval(),extractorTransport:extractor(),modelTransport:model,judgeTransport:judgePass(),store,independenceMode:'required'})
 const out=await exec.run('r',{limit:2})
 assert.equal(out.status,'delivered')
 assert.equal(out.extractedClaims.length,2)
 assert.match(out.delivery.finalized.rendered.renderedText,/Study A reports/)
 assert.match(out.delivery.finalized.rendered.renderedText,/Study B reports/)
 assert.match(out.delivery.finalized.rendered.renderedText,/mixed/)
})

test('research execution stops before reviewer when analyst erases counter-evidence', async () => {
 const store=new MemoryRecordStore(); const research=new ResearchGovernanceService({store}); research.createSession({sessionId:'r2',question:'Does method A outperform the baseline?'})
 const model=createScriptedTransport([
  req=>({schema:'ppl.product.handoff-receiver-response/1',message:'A is better.',claims:req.handoff.payload.claims.filter(c=>c.polarity!=='oppose')}),
 ],{model:'agent',independenceGroup:'agent'})
 const exec=new ResearchExecutionService({researchService:research,retrievalProvider:retrieval(),extractorTransport:extractor(),modelTransport:model,judgeTransport:judgePass(),store,independenceMode:'required'})
 const out=await exec.run('r2',{limit:2})
 assert.equal(out.status,'blocked-analyst-fidelity')
 assert.ok(out.analyst.fidelity.findings.some(x=>x.code==='COUNTER_EVIDENCE_ERASURE'))
 assert.equal(out.reviewer,null)
})

test('research execution fails closed when bound-delivery semantic judge rejects conclusion', async () => {
 const store=new MemoryRecordStore(); const research=new ResearchGovernanceService({store}); research.createSession({sessionId:'r3',question:'Does method A outperform the baseline?'})
 const model=createScriptedTransport([
  req=>({schema:'ppl.product.handoff-receiver-response/1',message:'mixed',claims:req.handoff.payload.claims}),
  req=>({schema:'ppl.product.research-review-response/1',derivedConclusion:'Method A is certainly superior.',claims:req.handoff.payload.claims}),
 ],{model:'agent',independenceGroup:'agent'})
 const rejectingJudge=createScriptedTransport([req=>({schema:'ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1',handoffId:req.handoffId,bindingId:req.bindingId,pass:false,counterEvidenceIntegrated:false,uncertaintyCalibrated:false,attributionPreservation:true,metricScopePreservation:true,conclusionSupported:false,noNovelFacts:true,findings:['counter-evidence not integrated','certainty overreach']})],{model:'judge',independenceGroup:'judge'})
 const exec=new ResearchExecutionService({researchService:research,retrievalProvider:retrieval(),extractorTransport:extractor(),modelTransport:model,judgeTransport:rejectingJudge,store,independenceMode:'required'})
 const out=await exec.run('r3',{limit:2})
 assert.equal(out.status,'blocked-by-semantic-judge')
 assert.equal(out.delivery.finalized.status,'blocked')
})


test('malformed boolean extraction is blocked before durable claim promotion',async()=>{
 const store=new MemoryRecordStore(),research=new ResearchGovernanceService({store});research.createSession({sessionId:'bad',question:'A vs B?'})
 const bad=createScriptedTransport([{schema:'ppl.product.research-evidence-extraction/1',relevant:'false',canonicalText:'Invented',polarity:'support',confidence:.8,rationale:'bad type'}],{model:'extractor'})
 const model=createScriptedTransport([],{model:'agent'})
 const exec=new ResearchExecutionService({researchService:research,retrievalProvider:retrieval(),extractorTransport:bad,modelTransport:model,judgeTransport:judgePass(),store})
 const run=await exec.run('bad',{limit:1})
 assert.equal(run.status,'blocked-extraction-failed');assert.equal(run.error.contractError,'RESPONSE_CONTRACT_INVALID')
 assert.equal(research.getEvidence('bad').length,0);assert.equal(model.calls.length,0)
})

test('analyst schema mismatch cannot bypass fidelity by copying valid claims',async()=>{
 const store=new MemoryRecordStore(),research=new ResearchGovernanceService({store});research.createSession({sessionId:'wrong-schema',question:'A vs B?'})
 const model=createScriptedTransport([req=>({schema:'wrong/1',message:'mixed',claims:req.handoff.payload.claims})],{model:'agent'})
 const judge=judgePass()
 const exec=new ResearchExecutionService({researchService:research,retrievalProvider:retrieval(),extractorTransport:extractor(),modelTransport:model,judgeTransport:judge,store})
 const run=await exec.run('wrong-schema',{limit:2})
 assert.equal(run.status,'blocked-analyst-model');assert.equal(run.analyst.contractError,'RESPONSE_CONTRACT_INVALID')
 assert.equal(run.reviewer,null);assert.equal(judge.calls.length,0)
})

test('string false in judge response never becomes a truthy delivery approval',async()=>{
 const store=new MemoryRecordStore(),research=new ResearchGovernanceService({store});research.createSession({sessionId:'judge-type',question:'A vs B?'})
 const model=createScriptedTransport([
  req=>({schema:'ppl.product.handoff-receiver-response/1',message:'mixed',claims:req.handoff.payload.claims}),
  req=>({schema:'ppl.product.research-review-response/1',derivedConclusion:'Evidence is mixed.',claims:req.handoff.payload.claims})
 ],{model:'agent'})
 const judge=createScriptedTransport([req=>({schema:'ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1',handoffId:req.handoffId,bindingId:req.bindingId,pass:'false',counterEvidenceIntegrated:true,uncertaintyCalibrated:true,attributionPreservation:true,metricScopePreservation:true,conclusionSupported:true,noNovelFacts:true,findings:[]})],{model:'judge'})
 const exec=new ResearchExecutionService({researchService:research,retrievalProvider:retrieval(),extractorTransport:extractor(),modelTransport:model,judgeTransport:judge,store})
 const run=await exec.run('judge-type',{limit:2})
 assert.equal(run.status,'blocked-judge-transport');assert.equal(run.delivery.contractError,'RESPONSE_CONTRACT_INVALID')
 assert.equal(run.delivery.finalized,undefined)
})

test('invalid research resource limits fail before creating an execution or calling retrieval',async()=>{
 const store=new MemoryRecordStore(),research=new ResearchGovernanceService({store});research.createSession({sessionId:'limits',question:'A vs B?'})
 const model=createScriptedTransport([],{model:'agent'})
 const exec=new ResearchExecutionService({researchService:research,retrievalProvider:retrieval(),modelTransport:model,judgeTransport:judgePass(),store})
 await assert.rejects(exec.run('limits',{limit:0}),{code:'INVALID_EXECUTION_LIMIT'})
 await assert.rejects(exec.run('limits',{maxEvidence:21}),{code:'INVALID_EXECUTION_LIMIT'})
 assert.equal(exec.listRuns().length,0)
})
