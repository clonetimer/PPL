import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  GPT_HOST_RESPONSE_SCHEMA,
  compileGptHostRequest,
  compileRetryRequest,
  validateGptHostResponse,
  applyResearchHostEvent,
  applyResearchModelResponse,
} from '../src/index.mjs'

const research = JSON.parse(fs.readFileSync(new URL('../profiles/research.profile.json', import.meta.url)))

function questionState() {
  return applyResearchHostEvent(research, structuredClone(research.initialState), {
    type: 'QUESTION_DEFINED', id: 'q:rc8', payload: { question: 'Is method A more stable than method B?' },
  }, { turn: 1, step: 0 }).state
}

function claimDraft(message = 'Generate a testable canonical hypothesis.') {
  return {
    schema: GPT_HOST_RESPONSE_SCHEMA,
    message,
    action: {
      kind: 'claim-proposal', conclusionStatus: 'blocked', conclusionDirection: 'undetermined',
      rationale: 'propose one testable hypothesis',
      claim: { id: 'claim:rc8', text: 'Method A is more stable than method B under repeated controlled experiments.', kind: 'hypothesis' },
      plan: null,
    },
    citations: [],
  }
}

test('RC8 validates claim-proposal payload before any durable mutation', () => {
  const request = compileGptHostRequest(research, questionState(), { turn: 1, userMessage: '建立一个可检验假设。' })
  const invalid = claimDraft()
  invalid.action.claim = null
  const check = validateGptHostResponse(request, invalid)
  assert.equal(check.valid, false)
  assert.ok(check.errors.includes('claim-proposal requires action.claim.id/text'))
  assert.throws(() => applyResearchModelResponse(research, questionState(), request, invalid), /Invalid GPT host response: claim-proposal requires action\.claim\.id\/text/)
})

test('RC8 Host-owned Research message repair pins the previously valid claim action', () => {
  const state = questionState()
  const request = compileGptHostRequest(research, state, { turn: 1, userMessage: '建立一个可检验的 canonical hypothesis。只提出假设，不宣称已被证明。' })
  const previous = claimDraft('生成可检验的 canonical hypothesis。')
  assert.equal(validateGptHostResponse(request, previous).valid, true)
  const retry = compileRetryRequest(request, {
    status: 'blocked', reason: 'policy-violation',
    violations: [{ code: 'RESEARCH_USER_VISIBLE_PLACEHOLDER', evidenceQuote: previous.message }],
  }, { attempt: 1, previousResponse: previous })

  assert.equal(retry.responseContract.hostOwnedMessage, true)
  assert.equal(retry.responseContract.hostOwnedAction, true)
  assert.deepEqual(retry.responseContract.jsonSchema.properties.action.properties.kind.enum, ['claim-proposal'])
  assert.deepEqual(retry.responseContract.jsonSchema.properties.action.properties.claim.properties.id.enum, ['claim:rc8'])
  assert.deepEqual(retry.responseContract.jsonSchema.properties.action.properties.claim.properties.text.enum, [previous.action.claim.text])
  assert.match(retry.responseContract.jsonSchema.properties.message.enum[0], /(?:已建立可检验假设|testable hypothesis has been established)/iu)

  const repaired = structuredClone(previous)
  repaired.message = retry.responseContract.jsonSchema.properties.message.enum[0]
  repaired.action.rationale = 'host-policy-safe-retry'
  const check = validateGptHostResponse(retry, repaired)
  assert.equal(check.valid, true, check.errors.join('; '))
  const applied = applyResearchModelResponse(research, state, retry, repaired)
  assert.equal(applied.state.research.activeClaimId, 'claim:rc8')
})

test('RC8 Host-owned Research repair cannot silently drop or replace a pinned claim', () => {
  const request = compileGptHostRequest(research, questionState(), { turn: 1, userMessage: '建立假设。' })
  const previous = claimDraft('research-plan')
  const retry = compileRetryRequest(request, {
    status: 'blocked', reason: 'policy-violation',
    violations: [{ code: 'RESEARCH_USER_VISIBLE_PLACEHOLDER', evidenceQuote: 'research-plan' }],
  }, { previousResponse: previous })
  const schema = retry.responseContract.jsonSchema.properties.action.properties
  assert.deepEqual(schema.kind.enum, ['claim-proposal'])
  assert.deepEqual(schema.claim.properties.id.enum, [previous.action.claim.id])
  assert.deepEqual(schema.claim.properties.text.enum, [previous.action.claim.text])
  assert.equal(schema.plan.type, 'null')
})

import { createCallbackTransport } from '../src/transport.mjs'
import { createPplLlmHostAdapter } from '../src/orchestrator.mjs'
import { GPT_POLICY_JUDGE_RESPONSE_SCHEMA } from '../src/index.mjs'

test('RC8 orchestrator preserves a valid claim-proposal through a Host-owned message retry and commits exactly once', async () => {
  let agentCalls = 0
  let judgeCalls = 0
  const claimId = 'claim:s17'
  const claimText = 'Method A is more stable than Method B under the sustained protocol.'
  const claim = { id: claimId, text: claimText, kind: 'hypothesis' }
  const agent = createCallbackTransport({
    identity: { provider: 'agent-provider', model: 'agent-v1', independenceGroup: 'agent' },
    invoke: async req => {
      agentCalls += 1
      if (agentCalls === 1) {
        return { status: 'completed', output: {
          schema: GPT_HOST_RESPONSE_SCHEMA,
          message: 'research-plan',
          action: { kind: 'claim-proposal', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: 'establish claim', claim: structuredClone(claim), plan: null },
          citations: [],
        } }
      }
      const a = req.responseContract.jsonSchema.properties.action.properties
      assert.deepEqual(a.kind.enum, ['claim-proposal'])
      assert.deepEqual(a.claim.properties.id.enum, [claimId])
      assert.deepEqual(a.claim.properties.text.enum, [claimText])
      return { status: 'completed', output: {
        schema: GPT_HOST_RESPONSE_SCHEMA,
        message: req.responseContract.jsonSchema.properties.message.enum[0],
        action: { kind: 'claim-proposal', conclusionStatus: 'blocked', conclusionDirection: 'undetermined', rationale: req.responseContract.jsonSchema.properties.action.properties.rationale.enum[0], claim: structuredClone(claim), plan: null },
        citations: [],
      } }
    },
  })
  const judge = createCallbackTransport({
    identity: { provider: 'judge-provider', model: 'judge-v1', independenceGroup: 'judge' },
    invoke: async req => {
      judgeCalls += 1
      const deterministic = req.deterministicViolations || []
      return { status: 'completed', output: {
        schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
        compliant: deterministic.length === 0,
        confidence: 0.99,
        violations: deterministic.map(v => ({ code: v.code, evidenceQuote: v.evidenceQuote, rationale: v.detail || 'deterministic guard' })),
      } }
    },
  })
  const adapter = createPplLlmHostAdapter({ agentTransport: agent, judgeTransport: judge, independenceMode: 'required', maxPolicyRetries: 1, transportDefaults: { maxAttempts: 1 } })
  const state = questionState()
  const out = await adapter.runAgentTurn(research, state, { sessionId: 'rc8-claim', turn: 1, userMessage: '建立一个可检验的 canonical hypothesis。' })
  assert.equal(out.status, 'delivered')
  assert.equal(agentCalls, 2)
  assert.equal(judgeCalls, 2)
  assert.equal(out.state.research.activeClaimId, claimId)
  assert.equal(Object.values(out.state.research.claims).find(row => row.id === claimId)?.text, claimText)
  assert.equal(out.audit.attempts[0].delivery.status, 'blocked')
  assert.equal(out.audit.attempts[1].delivery.status, 'deliver')
  assert.equal(out.audit.durableMutation, true)
})
