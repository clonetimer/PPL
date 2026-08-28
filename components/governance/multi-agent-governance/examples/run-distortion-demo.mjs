import fs from 'node:fs'
import {
  compileGovernance, buildGovernedHandoff, assessInformationFidelity,
} from '../src/index.mjs'

const fixture = JSON.parse(fs.readFileSync(new URL('./supervisor-worker.json', import.meta.url), 'utf8'))
const governance = compileGovernance(fixture.contracts)
const handoffResult = buildGovernedHandoff(governance, {
  delegation: {
    sourceAgentId: 'supervisor', targetAgentId: 'analyst', taskId: 'task-1', depth: 1, chain: ['supervisor'],
    requestedCapabilities: ['evidence-analysis'], requestedTools: ['paper-read'], requestedAuthorityScopes: ['research-task']
  },
  context: fixture.context,
  requiredClaimIds: ['claim-a', 'claim-b'],
  task: { instruction: 'Compare the evidence without collapsing disagreement.' },
  transform: { mode: 'verbatim' },
})
if (!handoffResult.allowed) throw new Error(`handoff unexpectedly blocked: ${JSON.stringify(handoffResult)}`)

const cleanReceived = {
  schema: 'ppl.multi-agent.context/0.1', state: handoffResult.handoff.payload.state,
  claims: handoffResult.handoff.payload.claims,
}
const clean = assessInformationFidelity({ handoff: handoffResult.handoff, receivedContext: cleanReceived, receivedTask: handoffResult.handoff.task })

const distortedClaims = handoffResult.handoff.payload.claims.filter(c => c.claimId !== 'claim-b').map(c => c.claimId === 'claim-a' ? { ...c, confidence: 0.98, status: 'confirmed' } : c)
const distortedReceived = { schema: 'ppl.multi-agent.context/0.1', state: { ...handoffResult.handoff.payload.state, leaked: { internalJudge: true } }, claims: distortedClaims }
const distorted = assessInformationFidelity({ handoff: handoffResult.handoff, receivedContext: distortedReceived, receivedTask: handoffResult.handoff.task })

console.log(JSON.stringify({ clean, distorted }, null, 2))
if (!clean.passed) throw new Error('clean handoff must pass')
if (distorted.passed) throw new Error('distorted handoff must fail')
