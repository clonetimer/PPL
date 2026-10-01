#!/usr/bin/env node
// Run ONLY against a separately extracted, installed dev.4 baseline. Never uses its normal database.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import { spawn } from 'node:child_process'
const root=path.resolve(process.argv[2] || '.')
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version
if(version!=='1.0.0-dev.4')throw new Error('Reproducer requires the unchanged 1.0.0-dev.4 baseline')
const execution=await import(pathToFileURL(path.join(root,'platform/execution/src/index.mjs')))
const findings=[]
const deps=execution.createExecutionDependenciesFromEnv({PPL_EXECUTION_ENABLED:'1',PPL_AGENT_MODEL:'same-model',PPL_JUDGE_MODEL:'same-model',PPL_AGENT_ENDPOINT:'http://127.0.0.1:1/v1/chat/completions',PPL_JUDGE_ENDPOINT:'http://localhost:2/v1/chat/completions',PPL_MODEL_INDEPENDENCE:'required'})
const oldDecision=execution.assertModelIndependence(deps.modelTransport,deps.judgeTransport,'required')
findings.push({id:'R4-001',name:'role-prefixed-groups-make-same-model-appear-independent',reproduced:oldDecision.independent===true})
const invalid=await execution.invokeStructured(execution.createScriptedTransport([{schema:'wrong/1',relevant:'false'}]),{responseContract:{jsonSchema:execution.RESEARCH_EVIDENCE_EXTRACTION_RESPONSE_SCHEMA}})
findings.push({id:'R4-002',name:'JSON-parse-success-without-response-contract-validation',reproduced:invalid.ok===true})
let followed=0
const server=http.createServer(async(req,res)=>{
 if(req.url==='/redirect'){res.writeHead(302,{location:'/target'});res.end();return}
 if(req.url==='/target'){followed++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({documents:[{text:'test-only document'}]}));return}
 for await(const _ of req){}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({schema:'ppl.live-probe/1',ok:false})}}]}))
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}`
try {
 await execution.createHttpJsonRetrievalProvider({endpoint:base+'/redirect'}).retrieve({query:'test-only'})
 findings.push({id:'R4-003',name:'retrieval-follows-redirect-without-boundary-recheck',reproduced:followed===1})
 const childEnv={...process.env,PPL_EXECUTION_ENABLED:'1',PPL_AGENT_MODEL:'A',PPL_JUDGE_MODEL:'B',PPL_AGENT_ENDPOINT:base+'/v1/chat/completions',PPL_JUDGE_ENDPOINT:base+'/v1/chat/completions',PPL_RETRIEVAL_KIND:'',NODE_NO_WARNINGS:'1'}
 const child=spawn(process.execPath,['platform/execution/bin/live-probe.mjs'],{cwd:root,env:childEnv})
 let stdout='';child.stdout.on('data',data=>stdout+=data)
 const exit=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject)})
 const report=JSON.parse(stdout)
 findings.push({id:'R4-004',name:'live-probe-accepts-semantic-ok-false',reproduced:exit===0 && report.agent.ok && report.judge.ok,observedExitCode:exit})
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
const allReproduced=findings.every(x=>x.reproduced)
console.log(JSON.stringify({schema:'ppl.r4-dev4-regression-reproduction/1',baselineVersion:version,mode:'local-fixtures-only',allReproduced,findings},null,2))
process.exitCode=allReproduced?0:1
