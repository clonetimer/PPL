import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  GPT_HOST_RESPONSE_SCHEMA, compileGptHostRequest, validateGptHostResponse,
  applyTutorLearnerAssessment, applyTutorModelResponse, applyTutorVerifier,
  applyResearchHostEvent, applyResearchModelResponse,
} from '../src/index.mjs'

const tutor = JSON.parse(await readFile(new URL('../profiles/tutor.profile.json', import.meta.url)))
const research = JSON.parse(await readFile(new URL('../profiles/research.profile.json', import.meta.url)))

test('GPT cannot patch durable state directly', () => {
  const req = compileGptHostRequest(tutor, tutor.initialState, { turn: 1, userMessage: 'help' })
  const res = { schema: GPT_HOST_RESPONSE_SCHEMA, message: 'x', action: { kind: 'tutor-intervention', policyMode: req.policy.mode }, durableStatePatch: { mastery: 1 } }
  const check = validateGptHostResponse(req, res)
  assert.equal(check.valid, false)
  assert.match(check.errors.join(' '), /durableStatePatch/)
})

test('Tutor model cannot override Profile-selected strategy', () => {
  const obs = applyTutorLearnerAssessment(tutor, tutor.initialState, {
    evidenceId: 'e1', skillId: 'fractions.addition', correct: false,
    assessment: { attemptCount: 1, hintCount: 0, original: true },
    misconception: { id: 'add_denominators', confidence: 0.9 },
  }, { turn: 1, step: 1 })
  const req = compileGptHostRequest(tutor, obs.state, { turn: 1, step: 2, userMessage: '4/10' })
  const res = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '诊断', action: { kind: 'tutor-intervention', policyMode: req.policy.mode, strategy: 'challenge', hintLevel: 0, rationale: 'model tried override' } }
  const out = applyTutorModelResponse(tutor, obs.state, req, res)
  assert.equal(out.event.payload.strategy, req.policy.mode)
  assert.equal(out.event.payload.hintLevel, req.policy.hintLevel)
})

test('Tutor verifier only updates after a real intervention', () => {
  assert.throws(() => {
    // Function itself accepts event; Profile records orphan diagnostic rather than throwing.
    const req = compileGptHostRequest(tutor, tutor.initialState, { turn: 1 })
    applyTutorModelResponse(tutor, tutor.initialState, req, { schema: GPT_HOST_RESPONSE_SCHEMA, message: '', action: { kind: 'tutor-intervention' } })
  }, /message required/)
  const orphan = applyTutorVerifier(tutor, tutor.initialState, { interventionId: 'missing', outcome: 'progress', confidence: 1 }, { turn: 1 })
  assert.equal(orphan.resolution.diagnostics.some(x => x.code === 'TUTOR_VERIFIER_ORPHAN'), true)
})

test('Research model citation must already exist in Host evidence', () => {
  let state = research.initialState
  state = applyResearchHostEvent(research, state, { type: 'QUESTION_DEFINED', payload: { question: 'Q' } }, { turn: 1 }).state
  const req = compileGptHostRequest(research, state, { turn: 1, userMessage: '研究' })
  const bad = { schema: GPT_HOST_RESPONSE_SCHEMA, message: 'claim', action: { kind: 'claim-proposal', claim: { id: 'c1', text: 'T' } }, citations: ['10.0000/fake'] }
  assert.equal(validateGptHostResponse(req, bad).valid, false)
})

test('Research GPT may propose claim but cannot create evidence', () => {
  let state = applyResearchHostEvent(research, research.initialState, { type: 'QUESTION_DEFINED', payload: { question: 'Q' } }, { turn: 1 }).state
  const req = compileGptHostRequest(research, state, { turn: 1, userMessage: '提出可检验 claim' })
  const res = { schema: GPT_HOST_RESPONSE_SCHEMA, message: '建议 claim', action: { kind: 'claim-proposal', claim: { id: 'c1', text: 'Claim', kind: 'empirical-claim' } } }
  const out = applyResearchModelResponse(research, state, req, res)
  assert.equal(out.state.research.activeClaimId, 'c1')
  assert.equal(out.state.research.evidenceLedger.length, 0)
})

import {
  GPT_OBSERVER_RESPONSE_SCHEMA, compileTutorObserverRequest, materializeTutorObservationFromObserver,
  compileResearchEvidenceJudgeRequest, materializeResearchEvidenceFromJudge,
} from '../src/index.mjs'

test('Tutor observer cannot operate without Host rubric and cannot infer affect', () => {
  assert.throws(() => compileTutorObserverRequest(tutor, tutor.initialState, { learnerResponse: '4/10' }), /rubric/)
  const req = compileTutorObserverRequest(tutor, tutor.initialState, { skillId: 'fractions.addition', prompt: '3/4+1/6', rubric: { expectedAnswer: '11/12' }, learnerResponse: '4/10' })
  assert.throws(() => materializeTutorObservationFromObserver(req, { schema: GPT_OBSERVER_RESPONSE_SCHEMA, correct: false, score: 0, confidence: 0.9, affect: { frustration: 1 } }), /affect is forbidden/)
})

test('Tutor observer low confidence does not become durable evidence', () => {
  const req = compileTutorObserverRequest(tutor, tutor.initialState, { skillId: 'fractions.addition', prompt: '3/4+1/6', rubric: { expectedAnswer: '11/12' }, learnerResponse: '4/10' })
  const out = materializeTutorObservationFromObserver(req, { schema: GPT_OBSERVER_RESPONSE_SCHEMA, correct: false, score: 0, confidence: 0.5 })
  assert.equal(out.accepted, false)
})

test('Research evidence judge cannot invent provenance', () => {
  let state = applyResearchHostEvent(research, research.initialState, { type: 'QUESTION_DEFINED', payload: { question: 'Q' } }, { turn: 1 }).state
  const reqClaim = compileGptHostRequest(research, state, { turn: 1 })
  state = applyResearchModelResponse(research, state, reqClaim, { schema: GPT_HOST_RESPONSE_SCHEMA, message: 'claim', action: { kind: 'claim-proposal', claim: { id: 'c1', text: 'Claim' } } }).state
  const req = compileResearchEvidenceJudgeRequest(research, state, { evidenceId: 'e1', source: { doi: '10.1/real', independenceGroup: 'g1' }, excerpt: 'The study did not find the predicted effect.', reliability: 0.9 })
  assert.throws(() => materializeResearchEvidenceFromJudge(req, { schema: GPT_OBSERVER_RESPONSE_SCHEMA, stance: 'oppose', relevance: 0.9, confidence: 0.9, doi: '10.1/fake' }), /provenance/)
})

test('provider-neutral transcript metadata is not hardcoded to ChatGPT', async () => {
  const { createTranscript, transcriptToAppSession } = await import('../src/index.mjs')
  const t = createTranscript(tutor, tutor.initialState)
  assert.equal(t.model.provider, 'unknown')
  assert.equal(t.model.transport, 'provider-neutral')
  const s = transcriptToAppSession(tutor, t)
  assert.equal(s.domain.host, 'ppl-llm-host-adapter')
  assert.equal(s.domain.model.provider, 'unknown')
})
