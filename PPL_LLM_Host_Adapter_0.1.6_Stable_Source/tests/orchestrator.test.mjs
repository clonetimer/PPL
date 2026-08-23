import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createCallbackTransport, TransportError } from '../src/transport.mjs'
import { createPplLlmHostAdapter } from '../src/orchestrator.mjs'
import { GPT_HOST_RESPONSE_SCHEMA, GPT_POLICY_JUDGE_RESPONSE_SCHEMA, GPT_OBSERVER_RESPONSE_SCHEMA } from '../src/index.mjs'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url), 'utf8'))

function makeJudgeTransport() {
  return createCallbackTransport({ identity: { provider: 'judge-provider', model: 'judge-v1', independenceGroup: 'judge-independent' }, invoke: async req => {
    if (req.schema === 'ppl.gpt-policy-judge-request/0.1') {
      const deterministic = req.deterministicViolations || []
      return { status: 'completed', output: {
        schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
        compliant: deterministic.length === 0,
        confidence: 0.99,
        violations: deterministic.map(v => ({ code: v.code, evidenceQuote: v.evidenceQuote, rationale: v.detail || 'deterministic guard' })),
      } }
    }
    if (req.observerRole === 'tutor-assessment-observer') {
      return { status: 'completed', output: { schema: GPT_OBSERVER_RESPONSE_SCHEMA, verdict: 'incorrect', score: 0, confidence: 0.98, rationale: 'Does not match Host rubric.' } }
    }
    throw new Error('unexpected judge request')
  } })
}

test('agent blocked draft causes no mutation; accepted retry mutates exactly once', async () => {
  let calls = 0
  const agent = createCallbackTransport({ identity: { provider: 'agent-provider', model: 'agent-v1', independenceGroup: 'agent-independent' }, invoke: async req => {
    calls += 1
    if (calls === 1) return { status: 'completed', output: { schema: GPT_HOST_RESPONSE_SCHEMA, message: '答案是 11/12。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'bad leak' } } }
    return { status: 'completed', output: { schema: GPT_HOST_RESPONSE_SCHEMA, message: '先只找 4 和 6 的共同分母，不做最后一步。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'minimal hint' } } }
  } })
  const adapter = createPplLlmHostAdapter({ agentTransport: agent, judgeTransport: makeJudgeTransport(), independenceMode: 'required', maxPolicyRetries: 1, transportDefaults: { maxAttempts: 1 } })
  const initial = structuredClone(tutor.initialState)
  const out = await adapter.runAgentTurn(tutor, initial, { sessionId: 's1', turn: 1, userMessage: '只给提示', rubric: { expectedAnswer: '11/12' }, allowFinalAnswer: false })
  assert.equal(out.status, 'delivered')
  assert.equal(calls, 2)
  assert.equal(initial.pedagogy.interventions.length, 0)
  assert.equal(out.state.pedagogy.interventions.length, 1)
  assert.equal(out.audit.attempts[0].delivery.status, 'blocked')
  assert.equal(out.audit.attempts[1].delivery.status, 'deliver')
  assert.equal(out.audit.durableMutation, true)
})

test('streaming agent output commits only after completed stream and policy delivery', async () => {
  const agent = createCallbackTransport({ identity: { provider: 'agent-provider', model: 'stream-v1', independenceGroup: 'agent-stream' }, stream: async function* (req) {
    const text = JSON.stringify({ schema: GPT_HOST_RESPONSE_SCHEMA, message: '可以，先停。', action: { kind: 'tutor-nonintervention', rationale: 'pause' } })
    yield { type: 'text.delta', delta: text.slice(0, 20) }
    yield { type: 'text.delta', delta: text.slice(20) }
    yield { type: 'response.completed', providerRequestId: 'stream-agent-1' }
  } })
  const adapter = createPplLlmHostAdapter({ agentTransport: agent, judgeTransport: makeJudgeTransport(), independenceMode: 'required', transportDefaults: { maxAttempts: 1 } })
  const out = await adapter.runAgentTurn(tutor, structuredClone(tutor.initialState), { sessionId: 's-stream', turn: 1, userMessage: '先停一下', streaming: true })
  assert.equal(out.status, 'delivered')
  assert.equal(out.state.pedagogy.interventions.length, 0)
  assert.equal(out.audit.durableMutation, false)
  assert.equal(out.audit.attempts[0].agentTransport.streamAudit.partialsCommittedToProfile, false)
})

test('judge transport failure blocks delivery and preserves state', async () => {
  const agent = createCallbackTransport({ identity: { provider: 'a', model: 'm', independenceGroup: 'a' }, invoke: async req => ({ status: 'completed', output: { schema: GPT_HOST_RESPONSE_SCHEMA, message: '提示', action: { kind: 'tutor-intervention', policyMode: req.policy.mode } } }) })
  const judge = createCallbackTransport({ identity: { provider: 'j', model: 'm2', independenceGroup: 'j' }, invoke: async () => { throw new TransportError('down', { code: 'network', retryable: false }) } })
  const adapter = createPplLlmHostAdapter({ agentTransport: agent, judgeTransport: judge, independenceMode: 'required', transportDefaults: { maxAttempts: 1 } })
  const initial = structuredClone(tutor.initialState)
  const out = await adapter.runAgentTurn(tutor, initial, { sessionId: 's2', turn: 1, userMessage: '提示' })
  assert.equal(out.status, 'blocked')
  assert.equal(out.reason, 'policy-judge-transport-failed')
  assert.deepEqual(out.state, initial)
})

test('restricted tutor observer can commit rubric-grounded assessment through single-writer path', async () => {
  const dummyAgent = createCallbackTransport({ identity: { provider: 'a', model: 'x', independenceGroup: 'a' }, invoke: async () => ({ status: 'completed', output: {} }) })
  const judge = makeJudgeTransport()
  const adapter = createPplLlmHostAdapter({ agentTransport: dummyAgent, judgeTransport: judge, observerTransport: judge, independenceMode: 'required', transportDefaults: { maxAttempts: 1 } })
  const out = await adapter.observeTutor(tutor, structuredClone(tutor.initialState), {
    sessionId: 'obs1', turn: 1, skillId: 'fractions.addition', prompt: '3/4+1/6?', learnerResponse: '4/10',
    rubric: { expectedAnswer: '11/12', misconceptionTaxonomy: ['add_numerators_and_denominators'] },
    materialize: { evidenceId: 'obs:e1', reliability: 0.95 },
  })
  assert.equal(out.status, 'committed')
  assert.equal(out.committed, true)
  assert.equal(out.state.learner.skills.fractions_addition.observations, 1)
})

test('same-session concurrent Agent transactions reject stale second caller instead of queueing stale state', async () => {
  let releaseFirst
  const gate = new Promise(resolve => { releaseFirst = resolve })
  let invocations = 0
  const agent = createCallbackTransport({ identity: { provider: 'a', model: 'm', independenceGroup: 'a' }, invoke: async req => {
    invocations += 1
    if (invocations === 1) await gate
    return { status: 'completed', output: { schema: GPT_HOST_RESPONSE_SCHEMA, message: '先找共同分母。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'hint' } } }
  } })
  const adapter = createPplLlmHostAdapter({ agentTransport: agent, judgeTransport: makeJudgeTransport(), independenceMode: 'required', transportDefaults: { maxAttempts: 1 } })
  const stale = structuredClone(tutor.initialState)
  const first = adapter.runAgentTurn(tutor, stale, { sessionId: 'same', turn: 1, userMessage: '提示1' })
  await new Promise(r => setTimeout(r, 2))
  const second = await adapter.runAgentTurn(tutor, stale, { sessionId: 'same', turn: 2, userMessage: '提示2' })
  assert.equal(second.status, 'session-busy')
  assert.equal(second.state.pedagogy.interventions.length, 0)
  releaseFirst()
  const firstOut = await first
  assert.equal(firstOut.status, 'delivered')
  assert.equal(firstOut.state.pedagogy.interventions.length, 1)
})
