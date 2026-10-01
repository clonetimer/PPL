// Intentionally synthetic. This module is imported only by tests / explicit demo entrypoints.
// The normal production Gateway never loads it and never silently substitutes these transports.
import { createCallbackTransport, createStaticRetrievalProvider } from '@ppl/platform-execution'
import { AgentExecutionService } from '@ppl/product-agent-governance'
import { createPlatformRuntime } from '../../product/platform-gateway/src/index.mjs'
import { defaultAgentInput } from '../../product/observatory/public/ui-model.mjs'

const finish = value => ({ status:'completed', output:JSON.stringify(value), toolCalls:[] })
export function createFixtureDependencies() {
  const modelTransport = createCallbackTransport({ identity:{provider:'fixture',model:'scripted-agent',independenceGroup:'fixture-agent'}, invoke:async request => {
    if (request.transportChatMessages) {
      const original = JSON.parse(request.transportChatMessages[1].content)
      return finish({schema:'ppl.product.handoff-receiver-response/1',message:'Fixture: host-owned lookup completed; canonical evidence retained.',claims:original.handoff.payload.claims})
    }
    if (request.transportTools?.length) {
      const call={callId:'fixture-call-1',name:'lookup',arguments:{key:'demo'}}
      return {status:'completed',output:'',toolCalls:[call],raw:{choices:[{message:{role:'assistant',content:'',tool_calls:[{id:call.callId,type:'function',function:{name:'lookup',arguments:JSON.stringify(call.arguments)}}]}}]}}
    }
    if (request.modelRole === 'research-evidence-extractor') {
      const oppose = request.document.documentId === 'fixture-study-b'
      return finish({schema:'ppl.product.research-evidence-extraction/1',relevant:true,canonicalText:oppose?'[Fixture] Study B did not reproduce a benefit for method A.':'[Fixture] Study A reported a benefit for method A.',polarity:oppose?'oppose':'support',confidence:.7,rationale:'Synthetic fixture, not a real publication.'})
    }
    const objective = request.handoff?.task?.objective || ''
    const claims = request.handoff?.payload?.claims || []
    if (request.modelRole === 'reviewer') return finish({schema:'ppl.product.research-review-response/1',derivedConclusion:objective.includes('[judge-reject]')?'[Fixture fault] Method A is certainly superior in every setting.':'[Fixture] Evidence is mixed; the benefit is not established. Both supporting and opposing results must remain visible.',claims})
    const received = objective.includes('[erase]') ? claims.filter(c => c.polarity !== 'oppose') : claims
    return finish({schema:'ppl.product.handoff-receiver-response/1',message:'[Fixture] Canonical claim handoff.',claims:received})
  } })
  const judgeTransport = createCallbackTransport({identity:{provider:'fixture',model:'scripted-judge',independenceGroup:'fixture-judge'},invoke:async request => {
    const reject = JSON.stringify(request).includes('certainly superior')
    return finish({schema:'ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1',handoffId:request.handoffId,bindingId:request.bindingId,pass:!reject,counterEvidenceIntegrated:!reject,uncertaintyCalibrated:!reject,attributionPreservation:true,metricScopePreservation:true,conclusionSupported:!reject,noNovelFacts:true,findings:reject?['Fixture rejection: counter-evidence omitted from conclusion; certainty overreach.']:[]})
  }})
  const retrievalProvider = createStaticRetrievalProvider([
    {id:'fixture-study-a',title:'Fixture Study A · 支持性样例',url:'https://example.test/study-a',text:'SYNTHETIC DEMO DATA. Method A showed a benefit in fixture A.'},
    {id:'fixture-study-b',title:'Fixture Study B · 反向证据样例',url:'https://example.test/study-b',text:'SYNTHETIC DEMO DATA. Fixture B did not reproduce the benefit.'},
  ])
  return {enabled:true,modelTransport,judgeTransport,retrievalProvider,independenceMode:'required',summary:{enabled:true,mode:'fixture',externalLiveQualified:false}}
}
export function createFixtureRuntime(store) {
  const dependencies = createFixtureDependencies()
  const runtime = createPlatformRuntime({store,executionDependencies:dependencies})
  runtime.agentExecution = new AgentExecutionService({governanceService:runtime.agent,modelTransport:dependencies.modelTransport,store,tools:[{
    name:'lookup',description:'Read a fixed local fixture. No external side effect.',parameters:{type:'object',additionalProperties:false,required:['key'],properties:{key:{type:'string'}}},execute:async args=>({fixture:true,value:`fixture:${args.key}`,externalSideEffect:false})
  }]})
  return runtime
}
export async function seedFixtureRuntime(runtime) {
  const existing=(app,id)=>runtime[app].listSessions().some(s=>s.sessionId===id)
  for (const [suffix,question] of [
    ['delivered','[Fixture] Does method A have sufficient supporting evidence?'],
    ['erasure','[Fixture] Does method A have sufficient evidence? [erase]'],
    ['judge-reject','[Fixture] Does method A have sufficient evidence? [judge-reject]'],
  ]) {
    const sessionId=`research-fixture-${suffix}`
    if(!existing('research',sessionId)){
      runtime.research.createSession({sessionId,question,metadata:{mode:'fixture',scenario:suffix}})
      await runtime.researchExecution.run(sessionId,{runId:`fixture-run-${suffix}`,limit:2})
    }
  }
  if(!existing('agent','agent-fixture-tools')){
    const definition=defaultAgentInput(); definition.agentContracts.forEach(c=>c.tools=['lookup'])
    definition.context.state.topic='[Fixture] Host-owned local lookup'
    definition.context.claims=[{claimId:'fixture-canonical',canonicalText:'[Fixture] The lookup is a local read-only example.',status:'provisional',polarity:'neutral',confidence:.5,sourceRefs:['fixture:local-source'],assertedBy:'source',sensitivity:'task',requiredForDecision:true,conflictSetId:null,derivedFrom:[],authorityScope:'work:evidence'}]
    runtime.agent.createSession({sessionId:'agent-fixture-tools',...definition,metadata:{mode:'fixture'}})
    await runtime.agentExecution.executeHandoff('agent-fixture-tools',{runId:'fixture-run-tools',sourceAgentId:'source',targetAgentId:'target',requestedCapabilities:['analyze'],requestedAuthorityScopes:['work:evidence'],requestedTools:['lookup'],task:{objective:'[Fixture] local lookup'},transform:{mode:'structured-summary',summary:'preserve canonical evidence'}})
  }
  if(!existing('tutor','tutor-fixture')){
    runtime.tutor.createSession({sessionId:'tutor-fixture',learnerId:'fixture-learner',skillId:'fractions.addition',metadata:{mode:'fixture'}})
    runtime.tutor.observe('tutor-fixture',{eventId:'fixture-observation',skillId:'fractions.addition',correct:true,assessment:{hintCount:2,attemptCount:2}})
  }
  if(!existing('life','life-fixture')){
    runtime.life.createSession({sessionId:'life-fixture',userId:'fixture-user',metadata:{mode:'fixture'}})
    runtime.life.setPreference('life-fixture',{requestId:'fixture-pref',key:'quietPlaces',value:true})
    runtime.life.observeRealtime('life-fixture',{eventId:'fixture-weather',locator:'fixture:weather:now',value:'not durable'})
  }
  if(!existing('character','character-fixture')){
    runtime.character.createSession({sessionId:'character-fixture',characterId:'fixture-character',metadata:{mode:'fixture'}})
    runtime.character.comfort('character-fixture',{eventId:'fixture-comfort'})
  }
  return runtime
}
