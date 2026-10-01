#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { runConfiguredQualification } from './qualification/runner.mjs'
let values
try { ({values} = parseArgs({options:{scope:{type:'string',default:'endpoints'},question:{type:'string'},output:{type:'string',default:'local-results/R4_EXECUTION_QUALIFICATION.json'},help:{type:'boolean',short:'h'}}})) }
catch { console.error('Invalid arguments. Use --help.'); process.exit(2) }
if (values.help) {
  console.log('Usage: npm run qualify:execution -- --scope endpoints|agent|research|all [--question "..."] [--output local-results/r4.json]\nResearch/all require --question or PPL_QUALIFY_QUESTION. Requests use configured endpoints and may consume API quota.\nExit: 0=requested sample scope passed; 1=failed; 2=configuration/CLI invalid. No scope certifies Stable or authenticates model identity.'); process.exit(0)
}
let report
try { report = await runConfiguredQualification(process.env,{scope:values.scope,question:values.question || process.env.PPL_QUALIFY_QUESTION || ''}) }
catch { report={schema:'ppl.execution-qualification/1',version:'1.0.0-dev.5',scope:values.scope,passed:false,status:'failed',exitCode:1,stableEligible:false,externalModelIdentityVerified:false,checks:[{name:'qualification-runner',status:'failed',code:'QUALIFICATION_INTERNAL_ERROR'}]} }
const destination = path.resolve(values.output), temporary = `${destination}.${randomUUID()}.tmp`
try {
  fs.mkdirSync(path.dirname(destination),{recursive:true})
  fs.writeFileSync(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600})
  fs.renameSync(temporary,destination)
} catch { try { fs.rmSync(temporary,{force:true}) } catch {} console.error('Could not write qualification report.'); process.exit(2) }
console.log(JSON.stringify(report,null,2))
process.exitCode = report.exitCode
