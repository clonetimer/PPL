import { randomUUID, createHash } from 'node:crypto'
import { invokeStructured } from './transports.mjs'
import { assertExecutionIndependence } from './independence.mjs'
export const sha256 = value => createHash('sha256').update(String(value)).digest('hex')
function deploymentFingerprint(value) {
  try { const url = new URL(value); url.username=''; url.password=''; url.search=''; url.hash=''; return sha256(url.toString()) }
  catch { return sha256(value || 'unknown') }
}
export function qualificationIdentity(transport) {
  const identity = transport?.identity || {}
  return { provider:String(identity.provider || 'unknown').slice(0,160), model:String(identity.model || 'unknown').slice(0,160),
    deploymentFingerprint:deploymentFingerprint(identity.deployment), groupFingerprint:sha256(identity.independenceGroup || 'unknown') }
}
export async function probeExecutionDependencies(deps, options = {}) {
  const report = { schema:'ppl.execution-endpoint-probe/2', passed:false, status:'not-configured',
    scope:'endpoint-contracts-only', modelCapabilityProven:false, externalModelIdentityVerified:false, checks:[] }
  const check = (name, passed, detail = {}) => report.checks.push({name, status:passed?'passed':'failed', ...detail})
  if (!deps?.enabled || !deps.modelTransport || !deps.judgeTransport) {
    check('execution-config',false,{code:'EXECUTION_NOT_CONFIGURED'}); return report
  }
  check('execution-config',true)
  report.identities = { agent:qualificationIdentity(deps.modelTransport), judge:qualificationIdentity(deps.judgeTransport) }
  try {
    // Qualification always requires distinct configured identities, even if runtime policy is relaxed.
    const independence = assertExecutionIndependence(deps.modelTransport, deps.judgeTransport, 'required')
    check('configured-model-independence',true,{basis:independence.basis,statisticalIndependenceProven:false})
  } catch {
    check('configured-model-independence',false,{code:'MODEL_INDEPENDENCE_REQUIRED'})
    report.status='failed'; return report
  }
  if (options.requireRetrieval !== false && !deps.retrievalProvider) {
    check('retrieval-config',false,{code:'RETRIEVAL_NOT_CONFIGURED'}); return report
  }
  const invokeOptions = { maxAttempts:1, timeoutMs:deps.summary?.httpLimits?.timeoutMs || 30000, ...options.transport, signal:options.signal }
  for (const [role,transport] of [['agent',deps.modelTransport],['judge',deps.judgeTransport]]) {
    const nonce = randomUUID()
    const expected = {schema:'ppl.execution-probe-response/2',ok:true,nonce}
    const request = {schema:'ppl.execution-probe-request/2',modelRole:'endpoint-probe',
      instructions:[`Return exactly this JSON object without extra fields: ${JSON.stringify(expected)}`], nonce,
      responseContract:{jsonSchema:{type:'object',additionalProperties:false,required:['schema','ok','nonce'],properties:{
        schema:{type:'string',const:expected.schema},ok:{type:'boolean',const:true},nonce:{type:'string',const:nonce}}}}}
    try {
      const result = await invokeStructured(transport,request,{...invokeOptions,label:`${role} endpoint probe`})
      check(`${role}-response-contract`,result.ok,{transportStatus:result.transport?.status || null,
        code:result.ok?null:result.contractError || (result.parseError?'INVALID_JSON':'TRANSPORT_FAILED'), contractIssues:result.contractIssues || []})
    } catch { check(`${role}-response-contract`,false,{code:'PROBE_INVOCATION_FAILED'}) }
  }
  if (options.requireRetrieval !== false) {
    if (!deps.retrievalProvider) check('retrieval-nonempty',false,{code:'RETRIEVAL_NOT_CONFIGURED'})
    else try {
      const result = await deps.retrievalProvider.retrieve({query:options.query || 'PPL governance',limit:1,signal:options.signal})
      const documents = result?.documents
      const ok = Array.isArray(documents) && documents.length > 0 && documents.every(d=>typeof d.text==='string' && d.text.trim())
      check('retrieval-nonempty',Boolean(ok),{code:ok?null:'RETRIEVAL_EMPTY_OR_INVALID', documentCount:Array.isArray(documents)?documents.length:0})
    } catch { check('retrieval-nonempty',false,{code:'RETRIEVAL_PROBE_FAILED'}) }
  }
  report.passed = report.checks.every(row=>row.status==='passed')
  report.status = report.passed?'passed':'failed'
  return report
}
