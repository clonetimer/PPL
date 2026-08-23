import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCallbackTransport } from '../src/transport.mjs'
import { createPplLlmHostAdapter } from '../src/orchestrator.mjs'
import { createToolRegistry, ToolExecutionLedger, AppendOnlyJsonlToolExecutionStore } from '../src/tools.mjs'
import { AppendOnlyJsonlRecoverableTurnStore, runRecoverableToolMediatedAgentTurn } from '../src/recoverable-lifecycle.mjs'
import { GPT_HOST_RESPONSE_SCHEMA, GPT_POLICY_JUDGE_RESPONSE_SCHEMA } from '../src/index.mjs'

const tutor = JSON.parse(fs.readFileSync(new URL('../profiles/tutor.profile.json', import.meta.url), 'utf8'))

function continuationBuilder(request, priorTransportResult, toolResults) {
  return {
    ...request,
    transportStructuredOutput: true,
    transportTools: [],
    transportContinuationTest: true,
    priorProviderRequestId: priorTransportResult.providerRequestId,
    hostToolResults: toolResults,
  }
}

function makeAgent(counters) {
  return createCallbackTransport({
    identity: { provider: 'agent', model: 'agent-v1', independenceGroup: 'agent-group' },
    invoke: async req => {
      counters.agent += 1
      if (!req.transportContinuationTest) {
        return {
          status: 'completed', output: '', providerRequestId: 'agent-initial-1', raw: { phase: 'initial' },
          toolCalls: [{ callId: 'call:magic:1', name: 'get_magic_number', arguments: {} }],
        }
      }
      assert.equal(req.hostToolResults[0].output.value, 7)
      return {
        status: 'completed', providerRequestId: 'agent-final-1', raw: { phase: 'final' },
        output: {
          schema: GPT_HOST_RESPONSE_SCHEMA,
          message: '先把两个分数化成相同分母，再比较对应分子。',
          action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'tool-grounded minimal hint' },
          citations: [],
        },
      }
    },
  })
}

function makeJudge(counters, compliant = true) {
  return createCallbackTransport({
    identity: { provider: 'judge', model: 'judge-v1', independenceGroup: 'judge-group' },
    invoke: async req => {
      counters.judge += 1
      if (compliant) return { status: 'completed', providerRequestId: 'judge-1', output: { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: true, confidence: 0.99, violations: [] } }
      return { status: 'completed', providerRequestId: 'judge-1', output: {
        schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: false, confidence: 0.99,
        violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', evidenceQuote: '先把两个分数化成相同分母', rationale: 'test policy block' }],
      } }
    },
  })
}

async function setup({ compliant = true } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ppl-recoverable-'))
  const counters = { agent: 0, judge: 0, tool: 0 }
  const registry = createToolRegistry([{
    name: 'get_magic_number', description: 'host-owned test tool', parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    execute: async () => { counters.tool += 1; return { value: 7 } },
  }])
  const makeAdapter = () => createPplLlmHostAdapter({
    agentTransport: makeAgent(counters), judgeTransport: makeJudge(counters, compliant), independenceMode: 'required',
    transportDefaults: { maxAttempts: 1 }, continuationRequestBuilder: continuationBuilder,
    toolExecutionLedger: new ToolExecutionLedger({ store: new AppendOnlyJsonlToolExecutionStore(path.join(dir, 'tool-ledger.jsonl')) }),
    turnStore: new AppendOnlyJsonlRecoverableTurnStore(path.join(dir, 'turn-ledger.jsonl')),
  })
  return { dir, counters, registry, makeAdapter }
}

function input(registry, extra = {}) {
  return {
    turnId: 'turn:1', sessionId: 'session:1', turn: 1,
    userMessage: '比较 3/4 和 2/3，只给提示。', rubric: { expectedAnswer: '3/4' }, allowFinalAnswer: false,
    toolRegistry: registry, ...extra,
  }
}

test('productized lifecycle runs Agent -> tool -> continuation -> independent Judge -> delivery -> state commit', async () => {
  const { counters, registry, makeAdapter } = await setup()
  const initial = structuredClone(tutor.initialState)
  const out = await makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
  assert.equal(out.status, 'delivered')
  assert.equal(out.committed, true)
  assert.equal(out.toolResults.length, 1)
  assert.equal(out.toolResults[0].replayed, false)
  assert.equal(counters.tool, 1)
  assert.equal(counters.agent, 2)
  assert.equal(counters.judge, 1)
  assert.equal(initial.pedagogy.interventions.length, 0)
  assert.equal(out.state.pedagogy.interventions.length, 1)
  assert.equal(out.audit.deliveryCommittedAfterJudge, true)
})

test('crash after durable tools-executed checkpoint resumes in a new Host without re-executing side effect', async () => {
  const { counters, registry, makeAdapter } = await setup()
  const initial = structuredClone(tutor.initialState)
  let crashed = false
  await assert.rejects(
    makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry, {
      lifecycleHook: ({ phase }) => { if (phase === 'after-tool-ledger-before-turn-checkpoint' && !crashed) { crashed = true; throw new Error('SIMULATED_PROCESS_CRASH') } },
    })),
    /SIMULATED_PROCESS_CRASH/,
  )
  assert.equal(counters.tool, 1)
  assert.equal(counters.agent, 1)
  const resumed = await makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
  assert.equal(resumed.status, 'delivered')
  assert.equal(resumed.resumed, true)
  assert.equal(resumed.toolResults[0].replayed, true)
  assert.equal(resumed.audit.resumedFromPhase, 'agent-tool-proposal')
  assert.equal(resumed.audit.toolResultsRecoveredFromDurableTurn, false)
  assert.equal(resumed.audit.toolResultsReplayedFromDurableLedger, true)
  assert.equal(counters.tool, 1)
  assert.equal(counters.agent, 2)
  assert.equal(counters.judge, 1)
})

test('committed turn is replayed without Agent, Judge, or tool execution', async () => {
  const { counters, registry, makeAdapter } = await setup()
  const initial = structuredClone(tutor.initialState)
  const adapter1 = makeAdapter()
  const first = await adapter1.runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
  assert.equal(first.status, 'delivered')
  const before = { ...counters }
  const replay = await makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
  assert.equal(replay.status, 'delivered')
  assert.equal(replay.replayedTurn, true)
  assert.deepEqual(counters, before)
})

test('resume rejects stale durable state and changed input identity before any side effect', async () => {
  const { counters, registry, makeAdapter } = await setup()
  const initial = structuredClone(tutor.initialState)
  let crashed = false
  await assert.rejects(makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry, {
    lifecycleHook: ({ phase }) => { if (phase === 'after-tool-ledger-before-turn-checkpoint' && !crashed) { crashed = true; throw new Error('CRASH') } },
  })), /CRASH/)
  const changedState = structuredClone(initial)
  changedState.pedagogy.interventions.push({ id: 'external' })
  const stale = await makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, changedState, input(registry))
  assert.equal(stale.status, 'stale-state')
  const changedInput = await makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry, { userMessage: 'different request' }))
  assert.equal(changedInput.status, 'blocked')
  assert.equal(changedInput.reason, 'turn-input-mismatch')
  assert.equal(counters.tool, 1)
})

test('policy block becomes terminal and never mutates durable profile state', async () => {
  const { counters, registry, makeAdapter } = await setup({ compliant: false })
  const initial = structuredClone(tutor.initialState)
  const out = await makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
  assert.equal(out.status, 'blocked')
  assert.equal(out.reason, 'policy-violation')
  assert.equal(out.committed, false)
  assert.deepEqual(out.state, initial)
  const before = { ...counters }
  const replay = await makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
  assert.equal(replay.replayedTurn, true)
  assert.deepEqual(counters, before)
})


test('0.1.6 Stable public helper delegates to lifecycle.run', async () => {
  const calls = []
  const lifecycle = { async run(profile, state, input) { calls.push({ profile, state, input }); return { status: 'ok' } } }
  const profile = { id: 'p' }
  const state = { x: 1 }
  const input = { turnId: 't' }
  const out = await runRecoverableToolMediatedAgentTurn(lifecycle, profile, state, input)
  assert.deepEqual(out, { status: 'ok' })
  assert.deepEqual(calls, [{ profile, state, input }])
})
