import { LifeGovernanceService } from '../src/index.mjs'
const service = new LifeGovernanceService()
service.createSession({ sessionId: 'demo-life', userId: 'user-1' })
console.log(service.setPreference('demo-life', { requestId: 'pref-1', key: 'quietPlaces', value: true, userMessage: '以后优先安静的地方' }))
console.log(service.observeRealtime('demo-life', { eventId: 'weather-1', locator: 'weather:tokyo:now', value: 'rain' }))
console.log(service.escalateHighRisk('demo-life', { eventId: 'risk-1', userMessage: '替我做医疗诊断', reason: 'medical', authoritativeLayer: 'qualified-medical-professional' }))
