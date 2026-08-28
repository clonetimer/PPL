import test from 'node:test'
import assert from 'node:assert/strict'
import { createLmStudioNativeJudgeTransport, buildLmStudioNativeJudgePrompt } from '../src/index.mjs'

const req={modelRole:'research',immutablePolicy:{conclusionStatus:'blocked'},agentMessage:'目前不能判断该假设已经被证实。',allowedPolicyCodes:['RESEARCH_CERTAINTY_OVERREACH','OTHER_POLICY_VIOLATION'],policyCodeDefinitions:{RESEARCH_CERTAINTY_OVERREACH:{definition:'unsupported certainty'},OTHER_POLICY_VIOLATION:{definition:'fallback'}},responseContract:{jsonSchema:{type:'object'}}}

test('prompt contains research negation rule and exact agent message',()=>{
  const p=buildLmStudioNativeJudgePrompt(req)
  assert.match(p.systemPrompt,/cannot determine that it is proven/i)
  assert.match(p.input,/目前不能判断/)
})

test('native transport forces reasoning off and maps final message',async()=>{
  let sent
  const fetchImpl=async(_url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({model_instance_id:'m1',output:[{type:'message',content:'{"schema":"ppl.gpt-policy-judge-response/0.2","compliant":true,"confidence":0.99,"violations":[]}'}],stats:{input_tokens:10,total_output_tokens:20,reasoning_output_tokens:0}}),{status:200,headers:{'content-type':'application/json'}})}
  const t=createLmStudioNativeJudgeTransport({model:'qwen3.5-0.8b',fetchImpl})
  const out=await t.invoke(req,{callId:'c1'})
  assert.equal(sent.reasoning,'off')
  assert.equal(sent.store,false)
  assert.equal(out.status,'completed')
  assert.equal(out.usage.reasoningTokens,0)
  assert.match(out.output,/"compliant":true/)
})

test('reasoning-only / empty final message is rejected',async()=>{
  const fetchImpl=async()=>new Response(JSON.stringify({output:[{type:'reasoning',content:'thinking'}],stats:{reasoning_output_tokens:200}}),{status:200})
  const t=createLmStudioNativeJudgeTransport({model:'qwen3.5-9b',fetchImpl})
  await assert.rejects(()=>t.invoke(req,{}),/no final message content/)
})

test('non-loopback endpoint is rejected by default',()=>{
  assert.throws(()=>createLmStudioNativeJudgeTransport({endpoint:'http://192.0.2.1:1234/api/v1/chat'}),/Refusing non-loopback/)
})
