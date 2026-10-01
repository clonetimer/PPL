import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { validateJsonContract, invokeStructured, createScriptedTransport, RESEARCH_EVIDENCE_EXTRACTION_RESPONSE_SCHEMA,
  createExecutionDependenciesFromEnv, assertExecutionIndependence, createHttpJsonRetrievalProvider, createSearxngRetrievalProvider,
  createBoundedFetch, probeExecutionDependencies } from '../src/index.mjs'
const extraction = {schema:'ppl.product.research-evidence-extraction/1',relevant:true,canonicalText:'Test claim',polarity:'support',confidence:.7,rationale:'A source snippet'}
const request = {responseContract:{jsonSchema:RESEARCH_EVIDENCE_EXTRACTION_RESPONSE_SCHEMA}}
for (const [label,value] of [
 ['false-as-string',{...extraction,relevant:'false'}], ['confidence-coercion',{...extraction,confidence:'0.7'}],
 ['confidence-overflow',{...extraction,confidence:1.2}], ['wrong-schema',{...extraction,schema:'other/1'}],
 ['missing-required',Object.fromEntries(Object.entries(extraction).filter(([k])=>k!=='relevant'))],
 ['unknown-property',{...extraction,ignore_gate:true}], ['null-root',null], ['array-root',[]],
]) test(`structured output rejects ${label}`, async()=>{
 const out = await invokeStructured(createScriptedTransport([JSON.stringify(value)]),request)
 assert.equal(out.ok,false); assert.equal(out.contractError,'RESPONSE_CONTRACT_INVALID')
})
test('irrelevant extraction can retain empty text without fabricating evidence',async()=>{
 const out=await invokeStructured(createScriptedTransport([{...extraction,relevant:false,canonicalText:''}]),request)
 assert.equal(out.ok,true); assert.equal(out.value.relevant,false)
})
test('unsupported schema keywords fail closed instead of pretending full JSON Schema support',()=>{
 assert.throws(()=>validateJsonContract('x',{oneOf:[{type:'string'}]}),/Unsupported/)
 assert.equal(validateJsonContract(null,{anyOf:[{type:'string'},{type:'null'}]}).valid,true)
 assert.equal(validateJsonContract(7,{anyOf:[{type:'string'},{type:'null'}]}).valid,false)
})
test('nested schema rejects wrong field types and inherited required properties',()=>{
 const schema={type:'object',required:['claims'],properties:{claims:{type:'array',items:{type:'object',required:['sources'],properties:{sources:{type:'array',items:{type:'string'}}}}}}}
 assert.equal(validateJsonContract({claims:[{sources:[123]}]},schema).valid,false)
 assert.equal(validateJsonContract(Object.create({claims:[]}),schema).valid,false)
})
test('structured-only invocation rejects unsolicited tool calls without executing them',async()=>{
 const model=createScriptedTransport([{status:'completed',output:JSON.stringify(extraction),toolCalls:[{name:'unexpected'}]}])
 const out=await invokeStructured(model,request);assert.equal(out.ok,false);assert.equal(out.contractError,'UNEXPECTED_TOOL_CALLS')
})
const env=(changes={})=>({PPL_EXECUTION_ENABLED:'1',PPL_AGENT_MODEL:'A',PPL_JUDGE_MODEL:'B',PPL_AGENT_ENDPOINT:'http://127.0.0.1:1/v1/chat/completions',PPL_JUDGE_ENDPOINT:'http://localhost:2/v1/chat/completions',PPL_MODEL_INDEPENDENCE:'required',...changes})
test('same configured model cannot become independent by changing ports or role labels',()=>{
 assert.throws(()=>createExecutionDependenciesFromEnv(env({PPL_JUDGE_MODEL:'A'})),{code:'MODEL_INDEPENDENCE_REQUIRED'})
 assert.throws(()=>createExecutionDependenciesFromEnv(env({PPL_JUDGE_MODEL:'A',PPL_AGENT_INDEPENDENCE_GROUP:'agent',PPL_JUDGE_INDEPENDENCE_GROUP:'judge'})),{code:'MODEL_INDEPENDENCE_REQUIRED'})
})
test('different model identifiers with a shared declared group are still rejected',()=>{
 assert.throws(()=>createExecutionDependenciesFromEnv(env({PPL_AGENT_INDEPENDENCE_GROUP:'shared',PPL_JUDGE_INDEPENDENCE_GROUP:'shared'})),{code:'MODEL_INDEPENDENCE_REQUIRED'})
})
test('preferred mode reports shared-model warning; distinct IDs do not prove statistical independence',()=>{
 const shared=createExecutionDependenciesFromEnv(env({PPL_JUDGE_MODEL:'A',PPL_MODEL_INDEPENDENCE:'preferred'}))
 assert.equal(shared.independence.independent,false)
 assert.ok(shared.independence.warnings.includes('SAME_MODEL_IDENTIFIER'))
 const distinct=createExecutionDependenciesFromEnv(env()); assert.equal(distinct.independence.independent,true)
 assert.equal(distinct.independence.statisticalIndependenceProven,false)
 assert.throws(()=>assertExecutionIndependence({}, {}, 'required'),{code:'MODEL_INDEPENDENCE_REQUIRED'})
})
test('endpoint userinfo, remote-without-opt-in and invalid numeric limits fail before network',()=>{
 assert.throws(()=>createExecutionDependenciesFromEnv(env({PPL_AGENT_ENDPOINT:'http://user:secret@127.0.0.1:1/v1'})),{code:'INVALID_ENDPOINT'})
 assert.throws(()=>createExecutionDependenciesFromEnv(env({PPL_AGENT_ENDPOINT:'https://example.test/v1'})),{code:'REMOTE_ENDPOINT_DISABLED'})
 assert.throws(()=>createExecutionDependenciesFromEnv(env({PPL_HTTP_TIMEOUT_MS:'NaN'})),{code:'INVALID_EXECUTION_LIMIT'})
 assert.throws(()=>createExecutionDependenciesFromEnv(env({PPL_MODEL_INDEPENDENCE:'unknown'})),{code:'INVALID_INDEPENDENCE_MODE'})
})
async function serve(t,handler) {
 const server=http.createServer(handler)
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}))
 return `http://127.0.0.1:${server.address().port}`
}
const send=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))}
test('HTTP response without a body arrives within a hard deadline',async t=>{
 const endpoint=await serve(t,()=>{})
 await assert.rejects(createBoundedFetch({timeoutMs:30})(endpoint),{code:'HTTP_TIMEOUT'})
})
test('HTTP deadline also covers an unfinished chunked response body',async t=>{
 const endpoint=await serve(t,(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{"documents":[')})
 await assert.rejects(createBoundedFetch({timeoutMs:40})(endpoint),{code:'HTTP_TIMEOUT'})
})
test('caller abort is distinct from a network or schema failure',async t=>{
 const endpoint=await serve(t,()=>{})
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20);t.after(()=>clearTimeout(timer))
 await assert.rejects(createBoundedFetch({timeoutMs:1000})(endpoint,{signal:controller.signal}),{code:'HTTP_ABORTED'})
})
test('redirect is blocked before following even a same-origin Location',async t=>{
 let downstream=0
 const endpoint=await serve(t,(req,res)=>{if(req.url==='/target'){downstream++;return send(res,{documents:[]})}res.writeHead(302,{location:'/target'});res.end()})
 const provider=createHttpJsonRetrievalProvider({endpoint,apiKey:'do-not-forward'})
 await assert.rejects(provider.retrieve({query:'test'}),{code:'HTTP_REDIRECT_BLOCKED'})
 assert.equal(downstream,0)
})
test('declared and actual chunked response sizes are independently bounded',async t=>{
 const endpoint=await serve(t,(req,res)=>{if(req.url==='/declared'){res.writeHead(200,{'content-length':'1000'});res.write('x')}else{res.writeHead(200);res.write('x'.repeat(129));res.end()}})
 const fetch=createBoundedFetch({maxBytes:128})
 await assert.rejects(fetch(endpoint+'/declared'),{code:'HTTP_BODY_TOO_LARGE'})
 await assert.rejects(fetch(endpoint+'/chunked'),{code:'HTTP_BODY_TOO_LARGE'})
})
test('retrieval limits response count and rejects oversized text instead of truncating evidence',async t=>{
 const endpoint=await serve(t,(_req,res)=>send(res,{documents:[{id:'a',text:'abcdef'},{id:'b',text:'second'}]}))
 const provider=createHttpJsonRetrievalProvider({endpoint})
 assert.equal((await provider.retrieve({query:'test',limit:1})).documents.length,1)
 await assert.rejects(createHttpJsonRetrievalProvider({endpoint,maxDocumentChars:3}).retrieve({query:'test'}),{code:'RETRIEVAL_DOCUMENT_TOO_LARGE'})
 await assert.rejects(provider.retrieve({query:'test',limit:0}),{code:'INVALID_EXECUTION_LIMIT'})
 await assert.rejects(provider.retrieve({query:'test',limit:1.5}),{code:'INVALID_EXECUTION_LIMIT'})
})
test('malformed retrieval and SearXNG payloads do not count as successful empty results',async t=>{
 const endpoint=await serve(t,(_req,res)=>send(res,{unexpected:'not results'}))
 for(const make of [createHttpJsonRetrievalProvider,createSearxngRetrievalProvider]) await assert.rejects(make({endpoint}).retrieve({query:'test'}),{code:'RETRIEVAL_CONTRACT_INVALID'})
})
test('retrieval rejects an excessive result count before document normalization',async t=>{
 const endpoint=await serve(t,(_req,res)=>send(res,{documents:Array.from({length:101},()=>({text:'x'}))}))
 await assert.rejects(createHttpJsonRetrievalProvider({endpoint}).retrieve({query:'test'}),{code:'RETRIEVAL_DOCUMENT_LIMIT'})
})
test('backend error text cannot reflect credential values into configured model errors',async t=>{
 const endpoint=await serve(t,(_req,res)=>send(res,{error:{message:'Bearer SECRET-VALUE'}},401))
 const deps=createExecutionDependenciesFromEnv(env({PPL_AGENT_ENDPOINT:endpoint,PPL_JUDGE_ENDPOINT:endpoint}))
 const out=await invokeStructured(deps.modelTransport,request,{maxAttempts:1})
 assert.equal(out.ok,false);assert.ok(!JSON.stringify(out).includes('SECRET-VALUE'))
})
test('strict endpoint probe rejects false ok, replayed nonce and arbitrary JSON',async()=>{
 for(const response of [{schema:'ppl.execution-probe-response/2',ok:false,nonce:'wrong'},{hello:'world'}]) {
  const deps={enabled:true,modelTransport:createScriptedTransport([response],{model:'A'}),judgeTransport:createScriptedTransport([response],{model:'B'})}
  const out=await probeExecutionDependencies(deps,{requireRetrieval:false})
  assert.equal(out.passed,false);assert.equal(out.checks.filter(c=>c.status==='failed').length,2)
 }
})
test('strict endpoint probe checks a fresh nonce and does not imply model capability',async()=>{
 const model=name=>createScriptedTransport([req=>({schema:'ppl.execution-probe-response/2',ok:true,nonce:req.nonce})],{model:name})
 const out=await probeExecutionDependencies({enabled:true,modelTransport:model('A'),judgeTransport:model('B')},{requireRetrieval:false})
 assert.equal(out.passed,true);assert.equal(out.modelCapabilityProven,false);assert.equal(out.externalModelIdentityVerified,false)
})
