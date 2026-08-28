import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileGptHostRequest, applyResearchHostEvent, applyResearchModelResponse } from '../src/index.mjs'

const tutor = JSON.parse(await readFile(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(await readFile(new URL('../profiles/research.profile.json', import.meta.url)))

test('0.1.7 Tutor response schema pins policyMode and forbids citations', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { turn: 1, userMessage: 'hint only' })
  const schema = req.responseContract.jsonSchema
  assert.deepEqual(schema.properties.action.properties.policyMode.enum, [req.policy.mode])
  assert.equal(schema.properties.citations.maxItems, 0)
})

test('0.1.7 Research response schema requires empty citations when Host has no evidence', () => {
  let state = applyResearchHostEvent(research, research.initialState, { type: 'QUESTION_DEFINED', payload: { question: 'Q' } }, { turn: 1 }).state
  const req = compileGptHostRequest(research, state, { turn: 1, userMessage: 'propose claim' })
  assert.equal(req.responseContract.jsonSchema.properties.citations.maxItems, 0)
})

test('0.1.7 Research response schema exposes only exact Host evidence and validation locators', () => {
  let state = applyResearchHostEvent(research, research.initialState, { type: 'QUESTION_DEFINED', payload: { question: 'Q' } }, { turn: 1 }).state
  const claimReq = compileGptHostRequest(research, state, { turn: 1, userMessage: 'claim' })
  state = applyResearchModelResponse(research, state, claimReq, {
    schema: 'ppl.gpt-host-response/0.1', message: 'claim', citations: [],
    action: { kind: 'claim-proposal', conclusionStatus: null, conclusionDirection: null, rationale: 'r', claim: { id: 'c1', text: 'Claim', kind: 'hypothesis' }, plan: null },
  }).state
  state = applyResearchHostEvent(research, state, {
    type: 'EVIDENCE_RECORDED', id: 'e1', payload: {
      evidenceId: 'e1', claimId: 'c1', stance: 'support', summary: 'S',
      source: { locator: 'app://source/A', title: 'A' }, independenceGroup: 'g1',
      quality: { relevance: 1, reliability: 1, independence: 1 },
    },
  }, { turn: 2 }).state
  state = applyResearchHostEvent(research, state, {
    type: 'VALIDATION_RESULT', id: 'v1', payload: {
      validationId: 'v1', claimId: 'c1', kind: 'experiment', method: 'rerun', outcome: 'support', confidence: 0.9,
      reproducible: true, strong: true, strongMethod: true, independenceGroup: 'g2', provenanceComplete: true,
      provenance: { locator: 'app://validation/B' },
    },
  }, { turn: 3 }).state
  const req = compileGptHostRequest(research, state, { turn: 4, userMessage: 'report' })
  const allowed = req.responseContract.jsonSchema.properties.citations.items.enum
  assert.deepEqual([...allowed].sort(), ['app://source/A','app://validation/B'])
})
