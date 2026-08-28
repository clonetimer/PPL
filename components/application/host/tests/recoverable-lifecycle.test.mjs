import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCallbackTransport } from '../src/transport.mjs'
import { createPplLlmHostAdapter } from '../src/orchestrator.mjs'
import { createToolRegistry, ToolExecutionLedger, AppendOnlyJsonlToolExecutionStore } from '../src/tools.mjs'
import { AppendOnlyJsonlRecoverableTurnStore } from '../src/recoverable-lifecycle.mjs'
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
        violations: [{ code: 'TUTOR_FINAL_ANSWER_LEAK', evidenceQuote: req.evidenceQuoteCandidates[0], rationale: 'test policy block' }],
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

test('0.1.12 recoverable JSONL stores one base checkpoint plus deltas and survives restart', async () => {
  const { dir, counters, registry, makeAdapter } = await setup()
  const initial = structuredClone(tutor.initialState)
  const first = await makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
  assert.equal(first.status, 'delivered')
  const file = path.join(dir, 'turn-ledger.jsonl')
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  assert.ok(lines.length >= 6)
  assert.ok(lines[0].checkpoint)
  assert.ok(lines.slice(1).every(row => row.checkpointPatch || row.deleted === true))
  let reconstructed = null
  let repeatedFullBytes = 0
  for (const row of lines) {
    if (row.checkpoint) reconstructed = row.checkpoint
    else if (row.checkpointPatch) reconstructed = { ...reconstructed, ...row.checkpointPatch }
    repeatedFullBytes += Buffer.byteLength(JSON.stringify({ turnId: row.turnId, checkpoint: reconstructed }) + '\n')
  }
  const actualBytes = fs.statSync(file).size
  assert.ok(actualBytes < repeatedFullBytes, `expected delta ledger ${actualBytes} < repeated full-checkpoint ledger ${repeatedFullBytes}`)
  const before = { ...counters }
  const replay = await makeAdapter().runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
  assert.equal(replay.replayedTurn, true)
  assert.deepEqual(counters, before)
})

test('0.1.12 recoverable store remains backward-compatible with legacy full-checkpoint JSONL', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ppl-recoverable-legacy-'))
  const file = path.join(dir, 'turn-ledger.jsonl')
  try {
    const checkpoint = {
      schema: 'ppl.recoverable-agent-turn-checkpoint/0.1', revision: 1, updatedAt: new Date().toISOString(),
      turnId: 'legacy:1', sessionId: 'legacy', profile: { id: 'p', version: '1', kind: 'tutor' }, phase: 'initialized',
    }
    fs.writeFileSync(file, JSON.stringify({ turnId: 'legacy:1', checkpoint }) + '\n')
    const store = new AppendOnlyJsonlRecoverableTurnStore(file)
    assert.deepEqual(await store.get('legacy:1'), checkpoint)
    await store.set('legacy:1', { ...checkpoint, revision: 2, phase: 'agent-final', updatedAt: new Date().toISOString() })
    const restored = await new AppendOnlyJsonlRecoverableTurnStore(file).get('legacy:1')
    assert.equal(restored.revision, 2)
    assert.equal(restored.phase, 'agent-final')
  } finally { await fsp.rm(dir, { recursive: true, force: true }) }
})

test('0.1.12 RC2 recoverable lifecycle retries a blocked post-tool policy draft without re-executing the tool', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ppl-recoverable-policy-retry-'))
  try {
    const counters = { agent: 0, judge: 0, tool: 0 }
    const registry = createToolRegistry([{
      name: 'get_magic_number', description: 'host-owned test tool',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      execute: async () => { counters.tool += 1; return { value: 7 } },
    }])
    const agent = createCallbackTransport({
      identity: { provider: 'agent', model: 'agent-v1', independenceGroup: 'agent-group' },
      invoke: async req => {
        counters.agent += 1
        if (!req.transportContinuationTest) {
          return { status: 'completed', providerRequestId: 'initial', output: '', toolCalls: [{ callId: 'call:retry:1', name: 'get_magic_number', arguments: {} }] }
        }
        assert.equal(req.hostToolResults[0].output.value, 7)
        if (counters.agent === 2) {
          return {
            status: 'completed', providerRequestId: 'blocked-final',
            output: { schema: GPT_HOST_RESPONSE_SCHEMA, message: '答案是 3/4。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'intentional leak' }, citations: [] },
          }
        }
        const allowedMessage = req.responseContract?.jsonSchema?.properties?.message?.enum?.[0]
        return {
          status: 'completed', providerRequestId: 'retry-final',
          output: { schema: GPT_HOST_RESPONSE_SCHEMA, message: allowedMessage || '先比较两个分母。', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'host-policy-safe-retry' }, citations: [] },
        }
      },
    })
    const judge = createCallbackTransport({
      identity: { provider: 'judge', model: 'judge-v1', independenceGroup: 'judge-group' },
      invoke: async req => {
        counters.judge += 1
        const deterministic = req.deterministicViolations || []
        return { status: 'completed', providerRequestId: `judge-${counters.judge}`, output: {
          schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
          compliant: deterministic.length === 0,
          confidence: 0.99,
          violations: deterministic.map(v => ({ code: v.code, evidenceQuote: v.evidenceQuote, rationale: v.detail || 'deterministic guard' })),
        } }
      },
    })
    const adapter = createPplLlmHostAdapter({
      agentTransport: agent, judgeTransport: judge, independenceMode: 'required',
      maxPolicyRetries: 1, maxStructuredOutputRetries: 1,
      transportDefaults: { maxAttempts: 1 }, continuationRequestBuilder: continuationBuilder,
      toolExecutionLedger: new ToolExecutionLedger({ store: new AppendOnlyJsonlToolExecutionStore(path.join(dir, 'tool-ledger.jsonl')) }),
      turnStore: new AppendOnlyJsonlRecoverableTurnStore(path.join(dir, 'turn-ledger.jsonl')),
    })
    const initial = structuredClone(tutor.initialState)
    const out = await adapter.runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
    assert.equal(out.status, 'delivered')
    assert.equal(out.committed, true)
    assert.equal(counters.tool, 1, 'policy retry must never re-execute the tool side effect')
    assert.equal(counters.agent, 3, 'tool proposal + blocked continuation + restricted retry')
    assert.equal(counters.judge, 2)
    assert.equal(out.state.pedagogy.interventions.length, 1)
    const rows = fs.readFileSync(path.join(dir, 'turn-ledger.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse)
    assert.ok(rows.some(row => row.checkpointPatch?.phase === 'retry-ready'))
  } finally { await fsp.rm(dir, { recursive: true, force: true }) }
})

test('0.1.12 RC2 recoverable lifecycle retries malformed Judge output without re-executing the durable tool', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ppl-recoverable-judge-structured-'))
  try {
    const counters = { agent: 0, judge: 0, tool: 0 }
    const registry = createToolRegistry([{
      name: 'get_magic_number', description: 'host-owned test tool',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      execute: async () => { counters.tool += 1; return { value: 7 } },
    }])
    const agent = makeAgent(counters)
    const judge = createCallbackTransport({
      identity: { provider: 'judge', model: 'judge-v1', independenceGroup: 'judge-group' },
      invoke: async () => {
        counters.judge += 1
        if (counters.judge === 1) return { status: 'completed', providerRequestId: 'judge-bad', output: 'not-json' }
        return { status: 'completed', providerRequestId: 'judge-good', output: { schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA, compliant: true, confidence: 0.99, violations: [] } }
      },
    })
    const adapter = createPplLlmHostAdapter({
      agentTransport: agent, judgeTransport: judge, independenceMode: 'required',
      maxPolicyRetries: 1, maxStructuredOutputRetries: 1,
      transportDefaults: { maxAttempts: 1 }, continuationRequestBuilder: continuationBuilder,
      toolExecutionLedger: new ToolExecutionLedger({ store: new AppendOnlyJsonlToolExecutionStore(path.join(dir, 'tool-ledger.jsonl')) }),
      turnStore: new AppendOnlyJsonlRecoverableTurnStore(path.join(dir, 'turn-ledger.jsonl')),
    })
    const initial = structuredClone(tutor.initialState)
    const out = await adapter.runRecoverableToolMediatedAgentTurn(tutor, initial, input(registry))
    assert.equal(out.status, 'delivered')
    assert.equal(counters.tool, 1)
    assert.equal(counters.agent, 2)
    assert.equal(counters.judge, 2)
    assert.equal(out.state.pedagogy.interventions.length, 1)
  } finally { await fsp.rm(dir, { recursive: true, force: true }) }
})
