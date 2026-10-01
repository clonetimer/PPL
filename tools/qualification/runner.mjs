// Isolated qualification; no normal PPL_DB, business Session, or UI fixture is reused.
import { MemoryRecordStore } from '@ppl/platform-core'
import { createExecutionDependenciesFromEnv, probeExecutionDependencies, invokeStructured, sha256 } from '@ppl/platform-execution'
import { AgentGovernanceService, AgentExecutionService } from '@ppl/product-agent-governance'
import { ResearchGovernanceService, ResearchExecutionService, createBoundDeliveryJudgeRequest } from '@ppl/product-research-governance'
export const QUALIFICATION_SCOPES = ['endpoints','agent','research','all']
function sampleClaim(id, polarity, assertedBy, authorityScope) {
  return {claimId:id,canonicalText:polarity==='support'?'Synthetic benchmark A measured method A at 10ms and method B at 20ms.':'Synthetic benchmark B measured method A at 30ms and method B at 20ms.',
    status:'provisional',polarity,confidence:.7,sourceRefs:[`qualification:synthetic:${id}`],assertedBy,sensitivity:'task',requiredForDecision:true,conflictSetId:'synthetic-speed-comparison',derivedFrom:[],authorityScope}
}
const questionForControls = 'Within the two supplied synthetic benchmarks, is method A consistently faster than method B?'
async function agentSample(deps, transportOptions) {
  const store = new MemoryRecordStore(), service = new AgentGovernanceService({store})
  const contract = (agentId,source) => ({schema:'ppl.multi-agent.agent-contract/0.1',agentId,role:agentId,authorityScopes:['work:evidence'],capabilities:[source?'handoff':'analyze'],tools:[],
    delegation:{allowedTargets:source?['target']:[],maxDepth:2,transferableAuthorityScopes:source?['work:evidence']:[],allowCycles:false,allowSelfDelegation:false},
    contextPolicy:{allowedSensitivities:['public','task'],allowedStatePaths:['question'],preserveConflictSets:true}})
  service.createSession({sessionId:'qualification-agent',agentContracts:[contract('source',true),contract('target',false)],context:{schema:'ppl.multi-agent.context/0.1',state:{question:questionForControls},
    claims:[sampleClaim('support','support','source','work:evidence'),sampleClaim('oppose','oppose','source','work:evidence')]}})
  const executor = new AgentExecutionService({governanceService:service,modelTransport:deps.modelTransport,store,transportOptions})
  const run = await executor.executeHandoff('qualification-agent',{sourceAgentId:'source',targetAgentId:'target',requestedCapabilities:['analyze'],requestedAuthorityScopes:['work:evidence'],
    task:{objective:questionForControls},transform:{mode:'structured-summary',summary:'Preserve both sides of this synthetic comparison.'}})
  return {name:'agent-handoff-sample',status:run.status==='completed'?'passed':'failed',runStatus:run.status,sampleKind:'synthetic-canonical-handoff',
    findingCodes:(run.fidelity?.findings || []).map(x=>x.code),sideEffectToolsTested:false}
}
async function judgeControl(deps, transportOptions, shouldPass) {
  const store = new MemoryRecordStore(), service = new ResearchGovernanceService({store})
  const sessionId = shouldPass?'judge-positive-control':'judge-negative-control'
  service.createSession({sessionId,question:questionForControls})
  const claims = ['support','oppose'].map(p=>service.addClaim(sessionId,sampleClaim(p,p,'researcher','research:evidence')))
  const prepared = service.prepareDelivery(sessionId,{parentClaimIds:claims.map(c=>c.claimId),derivedConclusion:shouldPass
    ? 'Synthetic results conflict: A is faster in benchmark A but slower in benchmark B. Consistent superiority is not established.'
    : 'Both synthetic benchmarks establish that method A is faster than method B.'})
  const invocation = await invokeStructured(deps.judgeTransport,createBoundDeliveryJudgeRequest(prepared),transportOptions)
  let finalized = null
  const validBinding = invocation.ok && invocation.value.handoffId===prepared.judgeRequest.handoffId && invocation.value.bindingId===prepared.judgeRequest.bindingId
  if (validBinding) finalized = service.finalizeDelivery(sessionId,{deliveryId:prepared.deliveryId,judgeResult:invocation.value})
  const correct = validBinding && invocation.value.pass===shouldPass && finalized?.status===(shouldPass?'delivered':'blocked')
  return {name:sessionId,status:correct?'passed':'failed',sampleKind:'synthetic-semantic-control',expectedPass:shouldPass,
    receivedPass:invocation.ok?invocation.value.pass:null,contractValid:invocation.ok,bindingValid:Boolean(validBinding),finalizationStatus:finalized?.status || null}
}
async function researchSample(deps, transportOptions, question) {
  const store = new MemoryRecordStore(), service = new ResearchGovernanceService({store})
  service.createSession({sessionId:'qualification-research',question,metadata:{purpose:'isolated-qualification'}})
  const executor = new ResearchExecutionService({researchService:service,retrievalProvider:deps.retrievalProvider,modelTransport:deps.modelTransport,judgeTransport:deps.judgeTransport,
    independenceMode:'required',store,transportOptions})
  const run = await executor.run('qualification-research',{limit:2,maxEvidence:2})
  return {name:'research-task-sample',status:run.status==='delivered'?'passed':'failed',runStatus:run.status,
    sampleKind:'configured-retrieval-and-models',documentCount:run.retrieval?.documents?.length || 0,claimCount:run.extractedClaims.length,
    evidenceFingerprint:sha256(JSON.stringify(service.getEvidence('qualification-research'))),
    renderedFingerprint:run.delivery?.finalized?.rendered?.renderedText?sha256(run.delivery.finalized.rendered.renderedText):null,
    findingCodes:[...(run.analyst?.fidelity?.findings || []),...(run.reviewer?.fidelity?.findings || [])].map(x=>x.code)}
}
export async function runExecutionQualification(deps, options = {}) {
  const scope = options.scope || 'endpoints', question = options.question || ''
  const report = {schema:'ppl.execution-qualification/1',version:'1.0.0-dev.5',generatedAt:new Date().toISOString(),
    scope,evidenceMode:options.evidenceMode || 'configured-endpoints-unattested',passed:false,status:'not-configured',exitCode:2,
    externalModelIdentityVerified:false,statisticalIndependenceProven:false,stableEligible:false,
    businessStoreTouched:false,configuredEndpointTaskSmokePassed:null,checks:[],
    limitations:['Only the explicitly requested sample scope is tested.','Synthetic controls are not model quality benchmarks.','No real-model identity attestation, browser qualification, side-effect recovery or production security qualification.']}
  if (!QUALIFICATION_SCOPES.includes(scope)) { report.checks.push({name:'scope',status:'failed',code:'INVALID_QUALIFICATION_SCOPE'}); return report }
  const needsResearch = ['research','all'].includes(scope)
  if (needsResearch && (!question.trim() || question.length>4000)) { report.checks.push({name:'question',status:'failed',code:'QUALIFICATION_QUESTION_REQUIRED_1_TO_4000_CHARS'}); return report }
  if (question) report.questionFingerprint = sha256(question)
  const preflight = await probeExecutionDependencies(deps,{query:question,requireRetrieval:scope!=='agent',transport:options.transport})
  report.checks.push(...preflight.checks)
  report.identities = preflight.identities || null
  if (!preflight.passed) { report.status=preflight.status; report.exitCode=preflight.status==='not-configured'?2:1; return report }
  report.configurationFingerprint = sha256(JSON.stringify({scope,identities:report.identities,limits:deps.summary?.httpLimits || null,independence:deps.independenceMode,retrievalKind:deps.retrievalProvider?.kind || null}))
  const transportOptions = {maxAttempts:1,timeoutMs:deps.summary?.httpLimits?.timeoutMs || 30000,...options.transport}
  async function record(name, task) {
    try { report.checks.push(await task()) }
    catch { report.checks.push({name,status:'failed',code:'QUALIFICATION_SAMPLE_FAILED'}) }
  }
  if (['agent','all'].includes(scope)) await record('agent-handoff-sample',()=>agentSample(deps,transportOptions))
  if (needsResearch) {
    await record('judge-positive-control',()=>judgeControl(deps,transportOptions,true))
    await record('judge-negative-control',()=>judgeControl(deps,transportOptions,false))
    report.judgeControlsPassed = report.checks.filter(x=>x.name.startsWith('judge-') && x.name.endsWith('-control')).every(x=>x.status==='passed')
    if (report.judgeControlsPassed) await record('research-task-sample',()=>researchSample(deps,transportOptions,question))
    else report.checks.push({name:'research-task-sample',status:'skipped',code:'JUDGE_CONTROLS_FAILED'})
  }
  const taskChecks = report.checks.filter(x=>['agent-handoff-sample','research-task-sample'].includes(x.name))
  if (taskChecks.length) report.configuredEndpointTaskSmokePassed = taskChecks.every(x=>x.status==='passed')
  report.passed = report.checks.every(x=>x.status==='passed')
  report.status=report.passed?'passed':'failed'; report.exitCode=report.passed?0:1
  return report
}
export async function runConfiguredQualification(env, options = {}) {
  let deps
  try { deps = createExecutionDependenciesFromEnv(env) }
  catch (error) { return {schema:'ppl.execution-qualification/1',version:'1.0.0-dev.5',generatedAt:new Date().toISOString(),scope:options.scope || 'endpoints',
    evidenceMode:'configured-endpoints-unattested',passed:false,status:'not-configured',exitCode:2,externalModelIdentityVerified:false,stableEligible:false,businessStoreTouched:false,
    checks:[{name:'execution-config',status:'failed',code:['EXECUTION_CONFIG_MISSING','INVALID_EXECUTION_LIMIT','INVALID_ENDPOINT','REMOTE_ENDPOINT_DISABLED','MODEL_INDEPENDENCE_REQUIRED','INVALID_INDEPENDENCE_MODE'].includes(error.code)?error.code:'EXECUTION_CONFIG_INVALID'}]} }
  return runExecutionQualification(deps,options)
}
