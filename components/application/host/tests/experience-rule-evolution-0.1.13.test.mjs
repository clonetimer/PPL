import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createCallbackTransport } from '../src/transport.mjs'
import { createPplLlmHostAdapter } from '../src/orchestrator.mjs'
import { GPT_HOST_RESPONSE_SCHEMA, GPT_POLICY_JUDGE_RESPONSE_SCHEMA } from '../src/index.mjs'
import { PPL_EXPERIENCE_RULE_SCHEMA } from '@ppl/experience-rule-evolution'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url), 'utf8'))

function rule(code='TUTOR_FINAL_ANSWER_LEAK', status='candidate') {
  return {
    schema: PPL_EXPERIENCE_RULE_SCHEMA,
    ruleId: `rule_${code.toLowerCase()}_prejudge_fastpath`,
    version: '0.1.0-candidate.1', status, domain: 'tutor', summary: 'test rule',
    activation: { detector: 'host-deterministic-policy-code', policyCodes: [code] },
    action: { phase: 'pre-judge', effect: 'retry-with-host-owned-repair', skipJudgeOnMatchedDraft: true, repairCompiler: 'compileRetryRequest' },
    authority: { precedence: 'below-host-policy', mustNotOverride: ['response-contract','profile-policy','durable-state','judge-on-unknown-failures'] },
    provenance: { sourceKind: 'test', evidenceSha256: ['a'.repeat(64)] },
  }
}

function judgeCounter() {
  let calls = 0
  const transport = createCallbackTransport({ identity: { provider:'judge',model:'j',independenceGroup:'j' }, invoke: async req => {
    calls += 1
    const deterministic = req.deterministicViolations || []
    return { status:'completed', output:{ schema:GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant:deterministic.length===0, confidence:0.99, violations:deterministic.map(v=>({code:v.code,evidenceQuote:v.evidenceQuote,rationale:v.detail||'deterministic'})) } }
  } })
  return { transport, calls: () => calls }
}

function responseForRequest(req, message) {
  const actionSchema = req.responseContract.jsonSchema.properties.action
  const props = actionSchema.properties
  const action = { kind: props.kind.enum?.[0] || 'tutor-intervention' }
  if (props.policyMode) action.policyMode = props.policyMode.enum?.[0] || req.policy?.mode
  if (props.rationale) action.rationale = props.rationale.enum?.[0] || 'bounded'
  return { schema:GPT_HOST_RESPONSE_SCHEMA, message, action }
}

test('evaluation rule skips first Judge call and uses Host-owned retry for known deterministic violation', async () => {
  let agentCalls = 0
  const agent = createCallbackTransport({ identity:{provider:'agent',model:'a',independenceGroup:'a'}, invoke:async req => {
    agentCalls += 1
    if (agentCalls === 1) return { status:'completed', output:responseForRequest(req,'答案是 11/12。') }
    const safe = req.responseContract.jsonSchema.properties.message.enum[0]
    return { status:'completed', output:responseForRequest(req,safe) }
  } })
  const judge = judgeCounter()
  const adapter = createPplLlmHostAdapter({ agentTransport:agent, judgeTransport:judge.transport, independenceMode:'required', maxPolicyRetries:1, transportDefaults:{maxAttempts:1}, experienceRules:[rule()], experienceRuleMode:'evaluation' })
  const out = await adapter.runAgentTurn(tutor, structuredClone(tutor.initialState), {sessionId:'er-eval',turn:1,userMessage:'只给提示',rubric:{expectedAnswer:'11/12'},allowFinalAnswer:false})
  assert.equal(out.status,'delivered')
  assert.equal(agentCalls,2)
  assert.equal(judge.calls(),1)
  assert.equal(out.audit.attempts.some(x=>x.phase==='experience-rule-fast-path'),true)
  assert.equal(out.audit.experienceRules.mode,'evaluation')
})

test('observe mode records match but retains Judge path', async () => {
  let agentCalls = 0
  const agent = createCallbackTransport({ identity:{provider:'agent',model:'a',independenceGroup:'a'}, invoke:async req => {
    agentCalls += 1
    if (agentCalls === 1) return { status:'completed', output:responseForRequest(req,'答案是 11/12。') }
    const safe = req.responseContract.jsonSchema.properties.message.enum[0]
    return { status:'completed', output:responseForRequest(req,safe) }
  } })
  const judge = judgeCounter()
  const adapter = createPplLlmHostAdapter({ agentTransport:agent, judgeTransport:judge.transport, independenceMode:'required', maxPolicyRetries:1, transportDefaults:{maxAttempts:1}, experienceRules:[rule()], experienceRuleMode:'observe' })
  const out = await adapter.runAgentTurn(tutor, structuredClone(tutor.initialState), {sessionId:'er-observe',turn:1,userMessage:'只给提示',rubric:{expectedAnswer:'11/12'},allowFinalAnswer:false})
  assert.equal(out.status,'delivered')
  assert.equal(judge.calls(),2)
  const ev = out.audit.attempts.find(x=>x.phase==='experience-rule-evaluation')
  assert.equal(ev.enforced,false)
  assert.equal(ev.skipJudge,false)
})

test('off mode preserves Stable Judge-before-policy-retry behavior for valid structured draft', async () => {
  let agentCalls=0
  const agent=createCallbackTransport({identity:{provider:'agent',model:'a',independenceGroup:'a'},invoke:async req=>{
    agentCalls += 1
    if(agentCalls===1) return {status:'completed',output:responseForRequest(req,'答案是 11/12。')}
    const safe=req.responseContract.jsonSchema.properties.message.enum[0]
    return {status:'completed',output:responseForRequest(req,safe)}
  }})
  const judge=judgeCounter()
  const adapter=createPplLlmHostAdapter({agentTransport:agent,judgeTransport:judge.transport,independenceMode:'required',maxPolicyRetries:1,transportDefaults:{maxAttempts:1}})
  const out=await adapter.runAgentTurn(tutor,structuredClone(tutor.initialState),{sessionId:'er-off',turn:1,userMessage:'只给提示',rubric:{expectedAnswer:'11/12'},allowFinalAnswer:false})
  assert.equal(out.status,'delivered')
  assert.equal(judge.calls(),2)
  assert.equal(out.audit.experienceRules.mode,'off')
})

test('structurally invalid draft retries locally without spending Judge call', async () => {
  let agentCalls=0
  const agent=createCallbackTransport({identity:{provider:'agent',model:'a',independenceGroup:'a'},invoke:async req=>{
    agentCalls += 1
    if(agentCalls===1) return {status:'completed',output:{schema:GPT_HOST_RESPONSE_SCHEMA,message:'broken'}}
    return {status:'completed',output:responseForRequest(req,'先找共同分母。')}
  }})
  const judge=judgeCounter()
  const adapter=createPplLlmHostAdapter({agentTransport:agent,judgeTransport:judge.transport,independenceMode:'required',maxPolicyRetries:1,transportDefaults:{maxAttempts:1}})
  const out=await adapter.runAgentTurn(tutor,structuredClone(tutor.initialState),{sessionId:'er-struct',turn:1,userMessage:'给提示'})
  assert.equal(out.status,'delivered')
  assert.equal(agentCalls,2)
  assert.equal(judge.calls(),1)
  assert.equal(out.audit.attempts.some(x=>x.phase==='pre-judge-structural'),true)
})

test('enforce mode rejects candidate rule at construction', () => {
  const judge=judgeCounter()
  const agent=createCallbackTransport({identity:{provider:'agent',model:'a',independenceGroup:'a'},invoke:async()=>({status:'completed',output:{}})})
  assert.throws(()=>createPplLlmHostAdapter({agentTransport:agent,judgeTransport:judge.transport,experienceRules:[rule()],experienceRuleMode:'enforce'}),/validated/)
})
