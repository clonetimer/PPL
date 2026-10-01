#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqliteRecordStore } from '@ppl/platform-core'
import { AgentGovernanceService } from '@ppl/product-agent-governance'
import { ResearchGovernanceService } from '@ppl/product-research-governance'
import { TutorGovernanceService } from '@ppl/product-tutor-governance'
import { LifeGovernanceService } from '@ppl/product-life-governance'
import { CharacterGovernanceService } from '@ppl/product-character-governance'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppl-suite-smoke-'))
const db = path.join(dir, 'ppl.sqlite')
let store = new SqliteRecordStore(db)
let agent = new AgentGovernanceService({ store })
let research = new ResearchGovernanceService({ store })
let tutor = new TutorGovernanceService({ store })
let life = new LifeGovernanceService({ store })
let character = new CharacterGovernanceService({ store })


const agentContracts = [
  { schema:'ppl.multi-agent.agent-contract/0.1', agentId:'a', role:'source', authorityScopes:['scope'], capabilities:['send'], tools:[], delegation:{allowedTargets:['b'],maxDepth:2,transferableAuthorityScopes:['scope'],allowCycles:false,allowSelfDelegation:false}, contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true} },
  { schema:'ppl.multi-agent.agent-contract/0.1', agentId:'b', role:'receiver', authorityScopes:['scope'], capabilities:['receive'], tools:[], delegation:{allowedTargets:[],maxDepth:2,transferableAuthorityScopes:[],allowCycles:false,allowSelfDelegation:false}, contextPolicy:{allowedSensitivities:['task'],allowedStatePaths:['topic'],preserveConflictSets:true} },
]
agent.createSession({ sessionId:'suite-agent', agentContracts, context:{ schema:'ppl.multi-agent.context/0.1', state:{topic:'x'}, claims:[] } })

research.createSession({ sessionId: 'suite-research', question: 'Does the evidence conflict?' })
research.addClaim('suite-research', { claimId: 'support', canonicalText: 'Study A supports the effect.', polarity: 'support', requiredForDecision: true, conflictSetId: 'effect', sourceRefs: ['study:a'] })
research.addClaim('suite-research', { claimId: 'oppose', canonicalText: 'Study B opposes the effect.', polarity: 'oppose', requiredForDecision: true, conflictSetId: 'effect', sourceRefs: ['study:b'] })
const blocked = research.createHandoff('suite-research', { sourceAgentId: 'researcher', targetAgentId: 'analyst', requestedCapabilities: ['analyze-evidence'], requestedAuthorityScopes: ['research:evidence'], allowedClaimIds: ['support'], task: { objective: 'analyze' } })
if (blocked.allowed) throw new Error('research counter-evidence projection should be blocked')

tutor.createSession({ sessionId: 'suite-tutor', skillId: 'fractions.addition' })
tutor.observe('suite-tutor', { evidenceId: 'obs-1', correct: true, assessment: { hintCount: 0, attemptCount: 1 } })

life.createSession({ sessionId: 'suite-life' })
life.setPreference('suite-life', { requestId: 'pref-1', key: 'quietPlaces', value: true })
life.observeRealtime('suite-life', { eventId: 'fact-1', locator: 'weather:now', value: 'rain' })

character.createSession({ sessionId: 'suite-character' })
character.confess('suite-character', { eventId: 'confession-1' })
store.close()

store = new SqliteRecordStore(db)
agent = new AgentGovernanceService({ store })
research = new ResearchGovernanceService({ store })
tutor = new TutorGovernanceService({ store })
life = new LifeGovernanceService({ store })
character = new CharacterGovernanceService({ store })

const result = {
  schema: 'ppl.product-suite-smoke/1',
  passed: true,
  persistence: {
    agentCount: agent.getSession('suite-agent').agentContracts.length,
    researchClaims: research.getEvidence('suite-research').length,
    tutorObservations: tutor.getSummary('suite-tutor').model.observations,
    lifeQuietPlaces: life.getSession('suite-life').state.preferences.quietPlaces,
    lifeRealtimeFactStored: life.getSession('suite-life').state.service.lastRealtimeFactStored,
    characterStage: character.getSession('suite-character').state.relationship.stage,
  },
  isolation: 'same sqlite store, distinct vertical namespaces',
}
store.close()
console.log(JSON.stringify(result, null, 2))
