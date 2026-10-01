import { AgentGovernanceService } from '../src/index.mjs'
const contracts = [
  { schema:'ppl.multi-agent.agent-contract/0.1', agentId:'source', role:'source', authorityScopes:['evidence'], capabilities:['analyze'], tools:[], delegation:{allowedTargets:['reviewer'],maxDepth:2,transferableAuthorityScopes:['evidence'],allowCycles:false,allowSelfDelegation:false}, contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true} },
  { schema:'ppl.multi-agent.agent-contract/0.1', agentId:'reviewer', role:'reviewer', authorityScopes:['evidence'], capabilities:['review'], tools:[], delegation:{allowedTargets:[],maxDepth:2,transferableAuthorityScopes:[],allowCycles:false,allowSelfDelegation:false}, contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true} },
]
const service = new AgentGovernanceService()
service.createSession({ sessionId:'demo-agent', agentContracts:contracts, context:{ schema:'ppl.multi-agent.context/0.1', state:{topic:'demo'}, claims:[
  {claimId:'a',canonicalText:'A supports.',status:'supported',polarity:'support',confidence:0.8,sourceRefs:['a'],assertedBy:'source',sensitivity:'task',requiredForDecision:true,conflictSetId:'x',derivedFrom:[],authorityScope:'evidence'},
  {claimId:'b',canonicalText:'B opposes.',status:'supported',polarity:'oppose',confidence:0.7,sourceRefs:['b'],assertedBy:'source',sensitivity:'task',requiredForDecision:true,conflictSetId:'x',derivedFrom:[],authorityScope:'evidence'}
] } })
const h = service.createHandoff('demo-agent', { sourceAgentId:'source', targetAgentId:'reviewer', requestedCapabilities:['review'], requestedAuthorityScopes:['evidence'], task:{objective:'review'} })
const report = service.assessHandoff('demo-agent', { handoffId:h.handoff.handoffId, receivedContext:{schema:'ppl.multi-agent.context/0.1', state:h.handoff.payload.state, claims:h.handoff.payload.claims.filter(x=>x.claimId!=='b')}, receivedTask:h.handoff.task })
console.log(JSON.stringify({ allowed:h.allowed, hardGatePassed:report.hardGatePassed, findings:report.findings }, null, 2))
