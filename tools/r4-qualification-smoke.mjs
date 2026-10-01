#!/usr/bin/env node
import assert from 'node:assert/strict'
import { startQualificationFixture } from './fixtures/r4-http-backend.mjs'
import { runConfiguredQualification } from './qualification/runner.mjs'
const scenarios=[]
for(const [name,fault,expected] of [
 ['valid-full-chain',{},true],['invalid-probe',{badProbe:true},false],['always-approve-judge',{judgeMode:'always-pass'},false],
 ['always-reject-judge',{judgeMode:'always-fail'},false],['analyst-erasure',{analystFault:'erasure'},false],['empty-retrieval',{emptyRetrieval:true},false],
]) {
 const fixture=await startQualificationFixture(fault)
 try {
  const result=await runConfiguredQualification(fixture.env,{scope:'all',question:'Does method A consistently outperform B in the supplied comparisons?',evidenceMode:'fixture-http'})
  assert.equal(result.passed,expected,JSON.stringify(result))
  scenarios.push({name,passed:true,expectedQualificationPass:expected,observedStatus:result.status,checks:result.checks})
 } finally { await fixture.close() }
}
console.log(JSON.stringify({schema:'ppl.r4-qualification-http-smoke/1',passed:true,evidenceMode:'fixture-http',externalModelIdentityVerified:false,scenarios},null,2))
