// Configuration identity is not evidence of statistically independent model errors.
import { boundaryError } from './http-boundary.mjs'
export function assertExecutionIndependence(agentTransport, judgeTransport, mode = 'preferred') {
  if (!['required','preferred','disabled'].includes(mode)) throw boundaryError('INVALID_INDEPENDENCE_MODE', 'Unsupported execution independence mode')
  const a = agentTransport?.identity || {}, j = judgeTransport?.identity || {}
  const known = value => typeof value === 'string' && value.trim() && value.trim() !== 'unknown'
  const warnings = []
  if (!known(a.model) || !known(j.model) || !known(a.independenceGroup) || !known(j.independenceGroup)) warnings.push('MODEL_IDENTITY_UNKNOWN')
  if (known(a.model) && known(j.model) && a.model.trim() === j.model.trim()) warnings.push('SAME_MODEL_IDENTIFIER')
  if (known(a.independenceGroup) && a.independenceGroup === j.independenceGroup) warnings.push('SHARED_INDEPENDENCE_GROUP')
  const independent = warnings.length === 0
  if (mode === 'required' && !independent) throw boundaryError('MODEL_INDEPENDENCE_REQUIRED', 'Agent/Judge configured independence requirement was not met')
  return { ok:true, mode, independent:mode === 'disabled' ? null : independent, warnings,
    basis:'configured-model-identifiers-and-groups', statisticalIndependenceProven:false,
    agent:a, judge:j }
}
