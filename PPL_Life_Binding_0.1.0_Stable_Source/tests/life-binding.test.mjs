import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { compileLifeHostRequest, lifeResponseJsonSchema, validateLifeHostResponse, applyLifeModelResponse, applyLifeHostRisk, observeLifeRealtimeFact } from '../src/index.mjs'
const profile = JSON.parse(fs.readFileSync(new URL('../profiles/life.profile.json', import.meta.url), 'utf8'))
const base = (kind, extra = {}, citations = []) => ({ schema:'ppl.gpt-host-response/0.1', message:'ok', action:{kind,rationale:'test',preference:null,plan:null,escalation:null,...extra}, citations })

test('Life request keeps realtime facts Host-owned and publishes exact citation enum', () => {
  const locator='weather:tokyo:2026-08-20T13:00+09:00'
  const req=compileLifeHostRequest(profile,profile.initialState,{userMessage:'东京现在下雨吗？',realtimeFacts:[{locator,observedAt:'2026-08-20T13:00:00+09:00',value:{raining:true}}]})
  assert.equal(req.modelRole,'life'); assert.deepEqual(req.responseContract.allowedCitationLocators,[locator])
  assert.deepEqual(req.responseContract.jsonSchema.properties.citations.items.enum,[locator])
  assert.equal(req.authority.modelMustNot.includes('persist-realtime-facts'),true)
  assert.equal(validateLifeHostResponse(req,base('life-service-response',{},[locator])).valid,true)
  assert.equal(validateLifeHostResponse(req,base('life-service-response',{},['request.realtimeFacts'])).valid,false)
})

test('no realtime facts makes citations schema empty-only',()=>{
  const req=compileLifeHostRequest(profile,profile.initialState,{userMessage:'按偏好回答'})
  assert.equal(req.responseContract.jsonSchema.properties.citations.maxItems,0)
  assert.equal(validateLifeHostResponse(req,base('life-service-response',{},[])).valid,true)
})

test('discriminated action schema requires preference object for preference proposal',()=>{
  const schema=lifeResponseJsonSchema({allowedCitationLocators:[]})
  assert.equal(Array.isArray(schema.properties.action.anyOf),true)
  const req=compileLifeHostRequest(profile,profile.initialState,{userMessage:'以后优先安静',mutationAuthorization:{preference:true}})
  assert.equal(validateLifeHostResponse(req,base('life-preference-proposal',{},[])).valid,false)
  const good=base('life-preference-proposal',{preference:{key:'quietPlaces',value:true}},[])
  assert.equal(validateLifeHostResponse(req,good).valid,true)
})

test('unauthorized inferred preference is blocked', () => {
  const req=compileLifeHostRequest(profile,profile.initialState,{userMessage:'推荐个地方'})
  const response=base('life-preference-proposal',{preference:{key:'quietPlaces',value:true}},[])
  const check=validateLifeHostResponse(req,response); assert.equal(check.valid,false); assert.ok(check.errors.some(x=>x.includes('not authorized')))
})

test('explicit preference proposal commits through deterministic Profile rule', () => {
  const req=compileLifeHostRequest(profile,profile.initialState,{userMessage:'以后优先安静的地方',mutationAuthorization:{preference:true}})
  const response=base('life-preference-proposal',{preference:{key:'quietPlaces',value:true}},[])
  const out=applyLifeModelResponse(profile,profile.initialState,req,response); assert.equal(out.state.preferences.quietPlaces,true); assert.equal(out.finalized.committed,true)
})

test('plan proposal must carry plan and commits only when authorized',()=>{
  const req=compileLifeHostRequest(profile,profile.initialState,{userMessage:'设计划',mutationAuthorization:{plan:true}})
  assert.equal(validateLifeHostResponse(req,base('life-plan-proposal',{},[])).valid,false)
  const good=base('life-plan-proposal',{plan:{plan:'明早列三件事'}},[])
  assert.equal(validateLifeHostResponse(req,good).valid,true)
  assert.equal(applyLifeModelResponse(profile,profile.initialState,req,good).state.plan.status,'active')
})

test('realtime fact observation never persists the realtime fact', () => {
  const out=observeLifeRealtimeFact(profile,profile.initialState,{locator:'weather:tokyo'}); assert.equal(out.state.service.lastRealtimeFactStored,false)
})

test('high-risk Host classification forces escalation with no pseudo citations', () => {
  const riskState=applyLifeHostRisk(profile,profile.initialState,{reason:'medical'}).state
  assert.equal(riskState.service.escalationRequired,true)
  const req=compileLifeHostRequest(profile,riskState,{userMessage:'高风险问题',hostRisk:{level:'high',reason:'medical',authoritativeLayer:'medical-authority'}})
  const bad=base('life-service-response',{},[]); assert.equal(validateLifeHostResponse(req,bad).valid,false)
  const good=base('life-escalation',{escalation:{required:true,reason:'medical'}},[]); assert.equal(validateLifeHostResponse(req,good).valid,true)
  const pseudo=base('life-escalation',{escalation:{required:true,reason:'medical'}},['hostRisk.level=high']); assert.equal(validateLifeHostResponse(req,pseudo).valid,false)
})

test('RC5 response contract only exposes Host-authorized action branches',()=>{
  const service=compileLifeHostRequest(profile,profile.initialState,{userMessage:'普通低风险请求'})
  assert.deepEqual(service.responseContract.actionKinds,['life-service-response'])
  assert.equal(service.responseContract.jsonSchema.properties.action.anyOf.length,1)
  assert.equal(service.responseContract.jsonSchema.properties.action.anyOf[0].properties.kind.enum[0],'life-service-response')

  const pref=compileLifeHostRequest(profile,profile.initialState,{userMessage:'长期偏好',mutationAuthorization:{preference:true}})
  assert.deepEqual(pref.responseContract.actionKinds,['life-service-response','life-preference-proposal'])
  assert.equal(pref.responseContract.jsonSchema.properties.action.anyOf.length,2)

  const plan=compileLifeHostRequest(profile,profile.initialState,{userMessage:'计划',mutationAuthorization:{plan:true}})
  assert.deepEqual(plan.responseContract.actionKinds,['life-service-response','life-plan-proposal'])

  const risk=compileLifeHostRequest(profile,profile.initialState,{userMessage:'高风险',hostRisk:{level:'high',reason:'medical'}})
  assert.deepEqual(risk.responseContract.actionKinds,['life-escalation'])
  assert.equal(risk.responseContract.jsonSchema.properties.action.anyOf.length,1)
  assert.equal(risk.responseContract.jsonSchema.properties.action.anyOf[0].properties.kind.enum[0],'life-escalation')
})

test('RC5 high-risk schema and validator no longer disagree about non-escalation branches',()=>{
  const req=compileLifeHostRequest(profile,profile.initialState,{userMessage:'直接给药',hostRisk:{level:'high',reason:'medical'}})
  assert.equal(req.responseContract.actionKinds.includes('life-service-response'),false)
  assert.equal(validateLifeHostResponse(req,base('life-service-response',{},[])).valid,false)
  assert.equal(validateLifeHostResponse(req,base('life-escalation',{escalation:{required:true,reason:'medical'}},[])).valid,true)
})
