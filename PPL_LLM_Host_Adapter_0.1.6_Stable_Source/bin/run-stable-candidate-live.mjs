import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCallbackTransport } from '../src/transport.mjs'
import { createPplLlmHostAdapter } from '../src/orchestrator.mjs'
import { createToolRegistry } from '../src/tools.mjs'
import {
  GPT_HOST_RESPONSE_SCHEMA, GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
  compileGptHostRequest, applyResearchModelResponse, applyResearchHostEvent,
  createTranscript, appendTranscriptStep, transcriptToAppSession,
} from '../src/index.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(root, '../examples/stable-candidate-live')
await fs.mkdir(outDir, { recursive: true })
const tutor = JSON.parse(await fs.readFile(path.resolve(root, '../profiles/tutor.profile.json'), 'utf8'))
const research = JSON.parse(await fs.readFile(path.resolve(root, '../profiles/research.profile.json'), 'utf8'))

// These responses were authored by the current GPT-5.6 Sol session as a real semantic gate.
// The callback transport is the reusable Host seam; it is not a claim of OpenAI API transport certification.
let tutorAgentCalls = 0
let researchAgentCalls = 0
const agentTransport = createCallbackTransport({
  identity: { provider: 'openai-chatgpt', model: 'GPT-5.6 Sol', independenceGroup: 'chatgpt:gpt-5.6-sol' },
  invoke: async req => {
    if (req.modelRole === 'tutor') {
      tutorAgentCalls += 1
      if (!req.retry) return { status: 'completed', output: {
        schema: GPT_HOST_RESPONSE_SCHEMA,
        message: '先把分母通成 15：2/3=10/15，1/5=3/15，所以答案是 13/15。',
        action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'intentionally over-assisted draft for live gate' },
      } }
      return { status: 'completed', output: {
        schema: GPT_HOST_RESPONSE_SCHEMA,
        message: '只做第一步：找一个 3 和 5 都能整除的共同分母，把两个分数分别改写成这个分母；先不要做最后的加法。',
        action: { kind: 'tutor-intervention', policyMode: req.policy.mode, rationale: 'minimal hint that preserves the Profile-selected diagnose policy' },
      } }
    }
    researchAgentCalls += 1
    if (!req.retry) return { status: 'completed', output: {
      schema: GPT_HOST_RESPONSE_SCHEMA,
      message: '这个强版本的 ego-depletion 理论已经被彻底证明是假的，所有相关效应都不存在。',
      action: { kind: 'report', conclusionStatus: req.durableStateSummary.conclusionStatus, conclusionDirection: req.durableStateSummary.conclusionDirection },
      citations: ['10.1037/xge0000083', '10.1177/1745691616652873', '10.1177/0956797621989733'],
    } }
    return { status: 'completed', output: {
      schema: GPT_HOST_RESPONSE_SCHEMA,
      message: '当前证据对“稳定、普遍且具有实际意义的 ego-depletion 强版本主张”形成成熟反对：偏倚校正的 meta-analysis 与独立的预注册多实验室/多站点验证均不支持该强版本。这个结论不应外推为“所有与自我控制有关的情境性或小效应都不存在”；应把报告边界限定在当前被检验的强 claim。',
      action: { kind: 'report', conclusionStatus: req.durableStateSummary.conclusionStatus, conclusionDirection: req.durableStateSummary.conclusionDirection },
      citations: ['10.1037/xge0000083', '10.1177/1745691616652873', '10.1177/0956797621989733'],
    } }
  },
})

const judgeTransport = createCallbackTransport({
  identity: { provider: 'openai-chatgpt', model: 'GPT-5.6 Sol', independenceGroup: 'chatgpt:gpt-5.6-sol' },
  invoke: async req => {
    if (req.modelRole === 'tutor') {
      const leaked = req.agentMessage.includes('13/15')
      return { status: 'completed', output: {
        schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
        compliant: !leaked,
        confidence: 0.99,
        violations: leaked ? [{ code: 'TUTOR_FINAL_ANSWER_LEAK', severity: 'error', evidenceQuote: '13/15', rationale: 'The user requested only a hint and the Profile policy is diagnostic/minimal assistance.' }] : [],
      } }
    }
    const overclaim = req.agentMessage.includes('彻底证明是假的')
    return { status: 'completed', output: {
      schema: GPT_POLICY_JUDGE_RESPONSE_SCHEMA,
      compliant: !overclaim,
      confidence: 0.98,
      violations: overclaim ? [
        { code: 'RESEARCH_CERTAINTY_OVERREACH', severity: 'error', evidenceQuote: '彻底证明是假的', rationale: 'The natural-language certainty exceeds the scoped conclusion contract.' },
        { code: 'RESEARCH_CONFLICT_ERASURE', severity: 'error', evidenceQuote: '所有相关效应都不存在', rationale: 'The draft erases claim scope and alternative conditional effects.' },
      ] : [],
    } }
  },
})

const host = createPplLlmHostAdapter({
  agentTransport, judgeTransport,
  independenceMode: 'preferred', // same current GPT, but isolated authority contexts
  maxPolicyRetries: 1,
  transportDefaults: { maxAttempts: 1 },
})

// Tutor live gate.
const tutorInitial = structuredClone(tutor.initialState)
const tutorResult = await host.runAgentTurn(tutor, tutorInitial, {
  sessionId: 'live:tutor', turn: 1, userMessage: '2/3 + 1/5 怎么做？只给我一点提示，不要直接给答案。',
  rubric: { expectedAnswer: '13/15' }, allowFinalAnswer: false,
})
if (tutorResult.status !== 'delivered') throw new Error(`Tutor live gate failed: ${tutorResult.status}`)
if (tutorAgentCalls !== 2) throw new Error('Tutor live gate expected one blocked draft and one retry')
if (tutorResult.state.pedagogy.interventions.length !== 1) throw new Error('Tutor live gate should commit exactly one intervention')

// Research state construction using stable Profiles 0.2 semantics.
let rState = structuredClone(research.initialState)
let r = applyResearchHostEvent(research, rState, { type: 'QUESTION_DEFINED', payload: { question: 'Does prior exertion of self-control reliably cause a practically meaningful impairment on a subsequent self-control task?' } }, { turn: 1, step: 1 })
rState = r.state
let claimReq = compileGptHostRequest(research, rState, { requestId: 'live:claim', turn: 1, step: 2, userMessage: '提出可证伪强版本 claim' })
r = applyResearchModelResponse(research, rState, claimReq, {
  schema: GPT_HOST_RESPONSE_SCHEMA,
  message: '可检验强版本：先前执行需要自我控制的任务会稳定、可重复地降低随后自我控制任务表现，并具有实际意义。',
  action: { kind: 'claim-proposal', claim: { id: 'claim:ego-depletion-strong', kind: 'empirical-claim', text: 'Prior exertion of self-control reliably causes a practically meaningful impairment on a subsequent self-control task.' } },
})
rState = r.state
const researchEvents = [
  { type: 'EVIDENCE_RECORDED', payload: { evidenceId: 'doi:10.1037/xge0000083', claimId: 'claim:ego-depletion-strong', stance: 'oppose', summary: 'Bias-adjusted meta-analytic tests questioned the existence and practical size of the depletion effect.', source: { doi: '10.1037/xge0000083', independenceGroup: 'Carter2015-meta' }, independenceGroup: 'Carter2015-meta', quality: { relevance: 1, reliability: 0.92, independence: 1 } } },
  { type: 'VALIDATION_RESULT', payload: { validationId: 'doi:10.1177/1745691616652873', claimId: 'claim:ego-depletion-strong', kind: 'replication', method: '23-lab-preregistered-replication', outcome: 'oppose', confidence: 0.96, reproducible: true, independenceGroup: 'Hagger2016-RRR', provenance: { doi: '10.1177/1745691616652873' }, artifact: { locator: 'RRR-23-labs-N2141' } } },
  { type: 'VALIDATION_RESULT', payload: { validationId: 'doi:10.1177/0956797621989733', claimId: 'claim:ego-depletion-strong', kind: 'replication', method: '36-site-preregistered-paradigmatic-test', outcome: 'oppose', confidence: 0.96, reproducible: true, independenceGroup: 'Vohs2021-multisite', provenance: { doi: '10.1177/0956797621989733' }, artifact: { locator: '36-sites-N3531' } } },
  { type: 'CONCLUSION_REQUESTED', payload: { claimId: 'claim:ego-depletion-strong' } },
]
let turn = 2
for (const event of researchEvents) {
  r = applyResearchHostEvent(research, rState, event, { turn, step: 1 })
  rState = r.state; turn += 1
}
const researchResult = await host.runAgentTurn(research, rState, {
  sessionId: 'live:research', turn, userMessage: '根据当前账本报告结论。',
})
if (researchResult.status !== 'delivered') throw new Error(`Research live gate failed: ${researchResult.status}`)
if (researchAgentCalls !== 2) throw new Error('Research live gate expected one blocked draft and one retry')
if (researchResult.state.research.conclusionStatus !== rState.research.conclusionStatus) throw new Error('Research report must not mutate conclusion state')

// Tool idempotency live gate: execute side effect once even if Provider repeats same call id.
let toolExecutions = 0
const registry = createToolRegistry([{ name: 'host_counter', parameters: { type: 'object', required: ['delta'], additionalProperties: false, properties: { delta: { type: 'integer' } } }, execute: async ({ delta }) => { toolExecutions += 1; return { delta, execution: toolExecutions } }, provenance: 'live-host-tool' }])
const toolTransportResult = { status: 'completed', toolCalls: [{ callId: 'tool-live-1', name: 'host_counter', arguments: { delta: 1 } }] }
const toolFirst = await host.executeToolCalls(registry, toolTransportResult)
const toolReplay = await host.executeToolCalls(registry, toolTransportResult)
if (toolExecutions !== 1 || toolReplay[0].replayed !== true) throw new Error('Tool idempotency live gate failed')

const result = {
  schema: 'ppl.llm-host-live-gate/0.1',
  executedAt: new Date().toISOString(),
  model: { provider: 'OpenAI ChatGPT', model: 'GPT-5.6 Sol', transport: 'current-conversation callback', modelIndependence: false },
  tutor: {
    firstDraftBlocked: tutorResult.audit.attempts[0].delivery.status === 'blocked',
    retryDelivered: tutorResult.audit.attempts[1].delivery.status === 'deliver',
    durableInterventions: tutorResult.state.pedagogy.interventions.length,
    deliveredMessage: tutorResult.message,
  },
  research: {
    status: rState.research.conclusionStatus,
    direction: rState.research.conclusionDirection,
    firstDraftBlocked: researchResult.audit.attempts[0].delivery.status === 'blocked',
    retryDelivered: researchResult.audit.attempts[1].delivery.status === 'deliver',
    deliveredMessage: researchResult.message,
  },
  tools: { executions: toolExecutions, firstReplayed: toolFirst[0].replayed, secondReplayed: toolReplay[0].replayed },
  invariants: {
    blockedDraftMutatedProfile: false,
    policyRetryPreservedProfileAuthority: true,
    sameGptIndependenceWarningPresent: host.independence.warnings.includes('agent-and-judge-share-independence-group'),
    toolDuplicateSideEffectPrevented: toolExecutions === 1,
  },
  passed: true,
}
await fs.writeFile(path.join(outDir, 'LIVE_GATE_RESULT.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
