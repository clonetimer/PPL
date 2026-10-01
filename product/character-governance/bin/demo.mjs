import { CharacterGovernanceService } from '../src/index.mjs'
const service = new CharacterGovernanceService()
service.createSession({ sessionId: 'demo-character', characterId: 'npc-1', userId: 'player-1' })
service.comfort('demo-character', { eventId: 'comfort-1' })
service.confess('demo-character', { eventId: 'confession-1' })
console.log(JSON.stringify(service.getSession('demo-character').state, null, 2))
