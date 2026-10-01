import { TutorGovernanceService } from '../src/index.mjs'
const service = new TutorGovernanceService()
const s = service.createSession({ sessionId: 'demo-tutor', learnerId: 'learner-1', skillId: 'fractions.addition' })
service.observe(s.sessionId, { evidenceId: 'q1', skillId: 'fractions.addition', correct: true, assessment: { hintCount: 2, attemptCount: 2 } })
const intervention = service.recordIntervention(s.sessionId, { interventionId: 'i1', strategy: 'worked-example', skillId: 'fractions.addition' })
service.verifyIntervention(s.sessionId, { interventionId: 'i1', outcome: 'progress', confidence: 0.9 })
console.log(JSON.stringify(service.getSummary(s.sessionId), null, 2))
