import { resolveProfileEventGeneric, runProfileScenario as runGenericScenario } from '@ppl/profile-core'
import { resolveTutorEvent } from '@ppl/profile-tutor'
import { resolveResearchEvent } from '@ppl/profile-research'

export function resolverFor(profile) {
  if (profile?.kind === 'tutor') return resolveTutorEvent
  if (profile?.kind === 'research') return resolveResearchEvent
  return resolveProfileEventGeneric
}

export function resolveProfileEvent(profile, baseState, event, context = {}) {
  return resolverFor(profile)(profile, baseState, event, context)
}

export function runProfileScenario(profile, scenario) {
  return runGenericScenario(profile, scenario, { resolveEvent: resolverFor(profile) })
}
