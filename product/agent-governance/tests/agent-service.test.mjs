import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqliteRecordStore } from '@ppl/platform-core'
import { AgentGovernanceService } from '../src/index.mjs'

const contracts = [
  { schema:'ppl.multi-agent.agent-contract/0.1', agentId:'a', role:'source', authorityScopes:['scope'], capabilities:['send'], tools:[], delegation:{allowedTargets:['b'],maxDepth:2,transferableAuthorityScopes:['scope'],allowCycles:false,allowSelfDelegation:false}, contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true} },
  { schema:'ppl.multi-agent.agent-contract/0.1', agentId:'b', role:'receiver', authorityScopes:['scope'], capabilities:['receive'], tools:[], delegation:{allowedTargets:[],maxDepth:2,transferableAuthorityScopes:[],allowCycles:false,allowSelfDelegation:false}, contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true} },
]
const context = { schema:'ppl.multi-agent.context/0.1', state:{topic:'x'}, claims:[
  {claimId:'support',canonicalText:'support',status:'supported',polarity:'support',confidence:0.8,sourceRefs:['s'],assertedBy:'a',sensitivity:'task',requiredForDecision:true,conflictSetId:'effect',derivedFrom:[],authorityScope:'scope'},
  {claimId:'oppose',canonicalText:'oppose',status:'supported',polarity:'oppose',confidence:0.7,sourceRefs:['o'],assertedBy:'a',sensitivity:'task',requiredForDecision:true,conflictSetId:'effect',derivedFrom:[],authorityScope:'scope'},
] }

test('generic gateway detects receiver counter-evidence erasure', () => {
  const service = new AgentGovernanceService(); service.createSession({ sessionId:'s', agentContracts:contracts, context })
  const handoff = service.createHandoff('s', { sourceAgentId:'a', targetAgentId:'b', requestedCapabilities:['receive'], requestedAuthorityScopes:['scope'], task:{objective:'review'} })
  assert.equal(handoff.allowed, true)
  const report = service.assessHandoff('s', { handoffId:handoff.handoff.handoffId, receivedContext:{schema:'ppl.multi-agent.context/0.1', state:handoff.handoff.payload.state, claims:handoff.handoff.payload.claims.filter(x=>x.claimId!=='oppose')}, receivedTask:handoff.handoff.task })
  assert.equal(report.hardGatePassed, false)
  assert.ok(report.findings.some(x => x.code === 'COUNTER_EVIDENCE_ERASURE'))
})

test('generic agent session survives sqlite restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ppl-agent-')); const db = path.join(dir,'ppl.sqlite')
  let store = new SqliteRecordStore(db); let service = new AgentGovernanceService({ store })
  service.createSession({ sessionId:'persist', agentContracts:contracts, context }); store.close()
  store = new SqliteRecordStore(db); service = new AgentGovernanceService({ store })
  assert.deepEqual(service.getSession('persist').agentContracts.map(x=>x.agentId), ['a','b']); store.close()
})
