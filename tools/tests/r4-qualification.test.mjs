import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { runConfiguredQualification } from '../qualification/runner.mjs'
import { startQualificationFixture } from '../fixtures/r4-http-backend.mjs'
const question='Does method A consistently outperform B in these supplied comparisons?'
const options={scope:'all',question,evidenceMode:'fixture-http'}
async function backend(t,fault={}){const fixture=await startQualificationFixture(fault);t.after(()=>fixture.close());return fixture}

test('all-scope qualification executes real localhost HTTP and separate Agent/Research pipelines',async t=>{
 const fixture=await backend(t)
 const out=await runConfiguredQualification(fixture.env,options)
 assert.equal(out.passed,true,JSON.stringify(out));assert.equal(out.exitCode,0);assert.equal(out.configuredEndpointTaskSmokePassed,true)
 assert.equal(out.judgeControlsPassed,true);assert.equal(out.externalModelIdentityVerified,false);assert.equal(out.stableEligible,false)
 assert.equal(out.evidenceMode,'fixture-http');assert.equal(out.businessStoreTouched,false)
 assert.equal(out.checks.find(c=>c.name==='research-task-sample').claimCount,2)
 assert.ok(fixture.calls.some(c=>c.role==='target'));assert.ok(fixture.calls.some(c=>c.role==='reviewer'))
 assert.ok(!JSON.stringify(out).includes('R4_TEST_ONLY_SECRET'));assert.ok(!JSON.stringify(out).includes(question))
})
test('unconfigured and invalid environments report NOT_CONFIGURED rather than passing zero checks',async()=>{
 for (const env of [{},{PPL_EXECUTION_ENABLED:'1'}]) {
  const out=await runConfiguredQualification(env,{scope:'endpoints'})
  assert.equal(out.passed,false);assert.equal(out.status,'not-configured');assert.equal(out.exitCode,2)
 }
})
test('full research qualification requires an explicit question before network activity',async t=>{
 const fixture=await backend(t)
 const out=await runConfiguredQualification(fixture.env,{scope:'all'})
 assert.equal(out.exitCode,2);assert.equal(fixture.calls.length,0)
})
test('endpoint-only success does not claim task or judge-control qualification',async t=>{
 const fixture=await backend(t)
 const out=await runConfiguredQualification(fixture.env,{scope:'endpoints',evidenceMode:'fixture-http'})
 assert.equal(out.passed,true);assert.equal(out.configuredEndpointTaskSmokePassed,null);assert.equal(out.judgeControlsPassed,undefined)
 assert.ok(!fixture.calls.some(c=>c.role==='reviewer'))
})
test('generic Agent scope remains usable without research retrieval configuration',async t=>{
 const fixture=await backend(t),env={...fixture.env};delete env.PPL_RETRIEVAL_KIND;delete env.PPL_RETRIEVAL_ENDPOINT
 const out=await runConfiguredQualification(env,{scope:'agent',evidenceMode:'fixture-http'})
 assert.equal(out.passed,true);assert.equal(out.configuredEndpointTaskSmokePassed,true)
 assert.ok(!fixture.calls.some(c=>c.role==='retrieval'))
})
test('false probe success prevents task execution despite valid JSON',async t=>{
 const fixture=await backend(t,{badProbe:true})
 const out=await runConfiguredQualification(fixture.env,options)
 assert.equal(out.passed,false);assert.equal(out.exitCode,1)
 assert.ok(!fixture.calls.some(c=>c.role==='reviewer' || c.role==='target'))
})
test('an always-approve Judge fails the negative control and stops the research sample',async t=>{
 const fixture=await backend(t,{judgeMode:'always-pass'})
 const out=await runConfiguredQualification(fixture.env,options)
 assert.equal(out.passed,false);assert.equal(out.judgeControlsPassed,false)
 assert.equal(out.checks.find(c=>c.name==='judge-positive-control').status,'passed')
 assert.equal(out.checks.find(c=>c.name==='judge-negative-control').status,'failed')
 assert.equal(out.checks.find(c=>c.name==='research-task-sample').status,'skipped')
 assert.ok(!fixture.calls.some(c=>c.role==='research-evidence-extractor'))
})
test('an always-reject Judge fails the positive control rather than looking safe',async t=>{
 const fixture=await backend(t,{judgeMode:'always-fail'})
 const out=await runConfiguredQualification(fixture.env,options)
 assert.equal(out.passed,false)
 assert.equal(out.checks.find(c=>c.name==='judge-positive-control').status,'failed')
 assert.equal(out.checks.find(c=>c.name==='judge-negative-control').status,'passed')
})
test('malformed Judge binding does not count as a successful negative control',async t=>{
 const fixture=await backend(t,{judgeMode:'wrong-binding'})
 const out=await runConfiguredQualification(fixture.env,options)
 assert.equal(out.passed,false)
 assert.equal(out.checks.find(c=>c.name==='judge-negative-control').status,'failed')
})
test('real HTTP analyst erasure is reported as a governance block, not a successful task',async t=>{
 const fixture=await backend(t,{analystFault:'erasure'})
 const out=await runConfiguredQualification(fixture.env,options),sample=out.checks.find(c=>c.name==='research-task-sample')
 assert.equal(out.passed,false);assert.equal(sample.runStatus,'blocked-analyst-fidelity')
 assert.ok(sample.findingCodes.includes('COUNTER_EVIDENCE_ERASURE'))
})
test('empty retrieval cannot satisfy qualification or trigger research execution',async t=>{
 const fixture=await backend(t,{emptyRetrieval:true})
 const out=await runConfiguredQualification(fixture.env,options)
 assert.equal(out.passed,false);assert.equal(out.checks.find(c=>c.name==='retrieval-nonempty').status,'failed')
 assert.ok(!fixture.calls.some(c=>c.role==='reviewer'))
})
async function cli(args,env){
 return new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(process.execPath,['tools/r4-qualify-execution.mjs',...args],{env:{...process.env,...env,NODE_NO_WARNINGS:'1'}})
 child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}))})
}
test('CLI writes a credential-minimized report and leaves configured business database bytes untouched',async t=>{
 const fixture=await backend(t)
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppl-r4-cli-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const db=path.join(dir,'private.sqlite'),output=path.join(dir,'report.json');fs.writeFileSync(db,'business-sentinel')
 const out=await cli(['--scope','all','--question',question,'--output',output],{...fixture.env,PPL_DB:db})
 assert.equal(out.code,0,out.stderr+out.stdout);assert.equal(fs.readFileSync(db,'utf8'),'business-sentinel')
 const report=JSON.parse(fs.readFileSync(output,'utf8'));assert.equal(report.passed,true);assert.equal(report.evidenceMode,'configured-endpoints-unattested')
 assert.ok(!fs.readFileSync(output,'utf8').includes('R4_TEST_ONLY_SECRET'))
 if(process.platform!=='win32') assert.equal(fs.statSync(output).mode & 0o777,0o600)
})
test('CLI missing configuration exits 2 and persists an explicit non-pass report',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppl-r4-cli-disabled-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const output=path.join(dir,'report.json')
 const out=await cli(['--output',output],{PPL_EXECUTION_ENABLED:'0'})
 assert.equal(out.code,2);assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).passed,false)
})


test('endpoint scope lacking retrieval configuration stops before consuming model calls',async t=>{
 const fixture=await backend(t),env={...fixture.env};delete env.PPL_RETRIEVAL_KIND;delete env.PPL_RETRIEVAL_ENDPOINT
 const out=await runConfiguredQualification(env,{scope:'endpoints'})
 assert.equal(out.status,'not-configured');assert.equal(out.exitCode,2);assert.equal(fixture.calls.length,0)
})
