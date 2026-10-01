#!/usr/bin/env node
// Compatibility entrypoint: strict nonce/schema probes; NOT a full task qualification.
import { createExecutionDependenciesFromEnv, probeExecutionDependencies } from '../src/index.mjs'
let report
try {
  const deps = createExecutionDependenciesFromEnv(process.env)
  report = await probeExecutionDependencies(deps,{query:process.env.PPL_PROBE_QUERY || 'PPL governance',requireRetrieval:Boolean(deps.retrievalProvider)})
} catch { report={schema:'ppl.execution-endpoint-probe/2',passed:false,status:'not-configured',scope:'endpoint-contracts-only',externalModelIdentityVerified:false,checks:[{name:'execution-config',status:'failed',code:'EXECUTION_CONFIG_INVALID'}]} }
console.log(JSON.stringify(report,null,2))
process.exitCode = report.passed?0:report.status==='not-configured'?2:1
