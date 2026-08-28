import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PPL_EXPERIENCE_RULE_SCHEMA,
  PPL_EXPERIENCE_EVALUATION_SCHEMA,
  validateExperienceRule,
  prepareExperienceRules,
  evaluatePreJudgeExperienceRules,
  distillDeterministicFastPathCandidate,
  buildExperienceRuleCapsule,
  buildExperienceEvaluation,
  validateExperienceEvaluation,
  aggregateExperienceEvaluations,
  buildPromotionPolicy,
  reviewPromotionCandidate,
  createEvolutionCandidate,
  validateEvolutionCandidate,
  buildEvolutionLedger,
  applyEvolutionTransition,
  rankEvolutionCandidates,
  detectEvolutionConvergence,
  planRestoreBest,
  promoteRuleCandidate,
  hashExperienceAsset,
} from '../src/index.mjs'

const H = ch => ch.repeat(64)

function rule(status='candidate', version='0.1.0-candidate.1') {
  return {
    schema: PPL_EXPERIENCE_RULE_SCHEMA,
    ruleId: 'rule_research_conflict_erasure_prejudge_fastpath',
    version, status, domain: 'research', summary: 'x',
    activation: { detector: 'host-deterministic-policy-code', policyCodes: ['RESEARCH_CONFLICT_ERASURE'] },
    action: { phase: 'pre-judge', effect: 'retry-with-host-owned-repair', skipJudgeOnMatchedDraft: true, repairCompiler: 'compileRetryRequest' },
    authority: { precedence: 'below-host-policy', mustNotOverride: ['response-contract','profile-policy','durable-state','judge-on-unknown-failures'] },
    provenance: { sourceKind: 'real-execution-replay', evidenceSha256: [H('a')] },
  }
}

function evaluation({evidenceClass='real-replay', sampleCount=10, candidate=1, baseline=0, gatePass=true, version='0.1.0'}={}) {
  return buildExperienceEvaluation({
    asset: { assetType:'rule', assetId:'rule_research_conflict_erasure_prejudge_fastpath', version },
    evidenceClass, sampleCount, evidenceSha256:[H(evidenceClass === 'real-soak' ? 'b' : evidenceClass === 'fault-injection' ? 'c' : evidenceClass === 'synthetic' ? 'd' : 'e')],
    hardGates: {
      'authority-inversion': { passed:gatePass, count:gatePass ? 0 : 1 },
      'state-corruption': true,
      'tool-duplication': true,
      'user-visible-leakage': true,
      'terminal-regression': true,
    },
    metrics: {
      knownFailureCoverage: { direction:'maximize', candidate, baseline },
      judgeCallsOnKnownBadDraft: { direction:'minimize', candidate:1-candidate, baseline:1 },
      deliveryRate: { direction:'maximize', candidate:1, baseline:1 },
    },
    findings: [], createdAt:'2026-08-27T00:00:00Z',
  })
}

function policy(extra={}) {
  return buildPromotionPolicy({
    policyId:'policy_test', riskClass:'L1',
    requiredHardGates:['authority-inversion','state-corruption','tool-duplication','user-visible-leakage','terminal-regression'],
    requiredEvidenceClasses:['real-replay','fault-injection','real-soak'],
    excludedEvidenceClasses:['synthetic'], minimumTotalSamples:30, minimumFitness:0.05, requireAnyImprovement:true,
    objectives:[
      {metric:'knownFailureCoverage',direction:'maximize',weight:0.5,maxRegressionNormalized:0},
      {metric:'judgeCallsOnKnownBadDraft',direction:'minimize',weight:0.3,maxRegressionNormalized:0},
      {metric:'deliveryRate',direction:'maximize',weight:0.2,maxRegressionNormalized:0},
    ],
    convergence:{patience:3,minImprovement:0.01}, ...extra,
  })
}

// 0.1 backward-compatible runtime contract
test('candidate rule validates', () => assert.equal(validateExperienceRule(rule()).valid, true))
test('enforce mode rejects candidate', () => assert.throws(() => prepareExperienceRules([rule()], 'enforce'), /validated/))
test('enforce mode accepts validated', () => assert.equal(prepareExperienceRules([rule('validated','0.1.0')], 'enforce').rules.length, 1))
test('off mode never enforces', () => {
  const out = evaluatePreJudgeExperienceRules(prepareExperienceRules([rule()], 'off'), { modelRole:'research', deterministicViolations:[{code:'RESEARCH_CONFLICT_ERASURE',severity:'error'}] })
  assert.equal(out.matched, true); assert.equal(out.skipJudge, false)
})
test('observe mode records but does not enforce', () => {
  const out = evaluatePreJudgeExperienceRules(prepareExperienceRules([rule()], 'observe'), { modelRole:'research', deterministicViolations:[{code:'RESEARCH_CONFLICT_ERASURE',severity:'error'}] })
  assert.equal(out.matched, true); assert.equal(out.enforced, false)
})
test('evaluation mode enforces candidate on matching deterministic code', () => {
  const out = evaluatePreJudgeExperienceRules(prepareExperienceRules([rule()], 'evaluation'), { modelRole:'research', deterministicViolations:[{code:'RESEARCH_CONFLICT_ERASURE',severity:'error',evidenceQuote:'x'}] })
  assert.equal(out.skipJudge, true); assert.equal(out.violations[0].experienceRuleIds[0], rule().ruleId)
})
test('domain mismatch does not match', () => {
  const out = evaluatePreJudgeExperienceRules(prepareExperienceRules([rule()], 'evaluation'), { modelRole:'tutor', deterministicViolations:[{code:'RESEARCH_CONFLICT_ERASURE',severity:'error'}] })
  assert.equal(out.matched, false)
})
test('unrelated deterministic code remains for Judge', () => {
  const out = evaluatePreJudgeExperienceRules(prepareExperienceRules([rule()], 'evaluation'), { modelRole:'research', deterministicViolations:[{code:'RESEARCH_CERTAINTY_OVERREACH',severity:'error'}] })
  assert.equal(out.skipJudge, false)
})
test('distillation requires real deterministic coverage threshold', () => {
  assert.throws(() => distillDeterministicFastPathCandidate({totalRecords:100,structurallyValidRecords:100,targetPolicyCodeMatches:50,policyCode:'X',domain:'research',evidenceSha256:[H('b')]}), /below minimum/)
})
test('distillation emits candidate rule above threshold', () => {
  const r = distillDeterministicFastPathCandidate({totalRecords:96,structurallyValidRecords:91,targetPolicyCodeMatches:91,policyCode:'RESEARCH_CONFLICT_ERASURE',domain:'research',evidenceSha256:[H('b')],distilledAt:'2026-08-25T00:00:00Z'})
  assert.equal(r.status,'candidate'); assert.equal(r.provenance.deterministicCoverage,1)
})
test('real-evidence capsule is provenance bound', () => {
  const cap = buildExperienceRuleCapsule({rule:rule(), replay:{realEvidence:true,totalRecords:96,artifacts:[{sha256:H('c')}]}, createdAt:'2026-08-25T00:00:00Z'})
  assert.match(cap.capsuleId,/^capsule_/)
})
test('capsule rejects synthetic-only evidence', () => assert.throws(() => buildExperienceRuleCapsule({rule:rule(), replay:{realEvidence:false,totalRecords:1,artifacts:[{}]}}),/real evidence/))

// 0.2 unified evaluation feedback
test('buildExperienceEvaluation emits strict 0.2 evaluation', () => {
  const e = evaluation()
  assert.equal(e.schema, PPL_EXPERIENCE_EVALUATION_SCHEMA)
  assert.equal(validateExperienceEvaluation(e).valid, true)
})
test('evaluation requires SHA-256 evidence', () => {
  assert.throws(() => buildExperienceEvaluation({asset:{assetType:'rule',assetId:'r',version:'1'},evidenceClass:'real-replay',sampleCount:1,evidenceSha256:['bad'],hardGates:{x:true},metrics:{m:{direction:'maximize',candidate:1,baseline:0}},findings:[]}), /SHA-256/)
})
test('aggregation weights metrics by sample count', () => {
  const a = evaluation({sampleCount:10,candidate:1})
  const b = evaluation({sampleCount:30,candidate:0.5})
  const agg = aggregateExperienceEvaluations([a,b])
  assert.equal(agg.totalSamples,40)
  assert.equal(agg.metrics.knownFailureCoverage.candidate,0.625)
})
test('aggregation excludes synthetic evidence when requested', () => {
  const agg = aggregateExperienceEvaluations([evaluation({evidenceClass:'real-replay'}),evaluation({evidenceClass:'synthetic'})],{excludeEvidenceClasses:['synthetic']})
  assert.deepEqual(agg.evidenceClasses,['real-replay'])
})

// multi-objective promotion
test('promotion eligible with all hard gates, evidence classes and positive fitness', () => {
  const review = reviewPromotionCandidate([
    evaluation({evidenceClass:'real-replay'}), evaluation({evidenceClass:'fault-injection'}), evaluation({evidenceClass:'real-soak'}), evaluation({evidenceClass:'synthetic',candidate:0}),
  ], policy(), {reviewedAt:'2026-08-27T00:00:00Z'})
  assert.equal(review.decision,'eligible')
  assert.ok(review.fitnessScore > 0)
  assert.equal(review.evidence.evidenceClasses.includes('synthetic'), false)
})
test('hard gate failure overrides good soft metrics', () => {
  const review = reviewPromotionCandidate([evaluation({evidenceClass:'real-replay',gatePass:false}),evaluation({evidenceClass:'fault-injection'}),evaluation({evidenceClass:'real-soak'})],policy())
  assert.equal(review.eligible,false)
  assert.match(review.reasons.join(';'),/hard gate failed/)
})
test('missing required evidence class holds promotion', () => {
  const review = reviewPromotionCandidate([evaluation({evidenceClass:'real-replay'}),evaluation({evidenceClass:'real-soak'})],policy({minimumTotalSamples:20}))
  assert.equal(review.eligible,false)
  assert.match(review.reasons.join(';'),/fault-injection/)
})
test('objective regression beyond threshold holds promotion', () => {
  const bad = [evaluation({evidenceClass:'real-replay',candidate:-0.5}),evaluation({evidenceClass:'fault-injection',candidate:-0.5}),evaluation({evidenceClass:'real-soak',candidate:-0.5})]
  const review = reviewPromotionCandidate(bad,policy({minimumFitness:-1,requireAnyImprovement:false}))
  assert.equal(review.eligible,false)
  assert.match(review.reasons.join(';'),/objective regression exceeded/)
})
test('L2 promotion requires explicit human approval', () => {
  const p = policy({riskClass:'L2',humanApprovalRequired:true})
  const evaluations = [evaluation({evidenceClass:'real-replay'}),evaluation({evidenceClass:'fault-injection'}),evaluation({evidenceClass:'real-soak'})]
  assert.equal(reviewPromotionCandidate(evaluations,p).eligible,false)
  assert.equal(reviewPromotionCandidate(evaluations,p,{humanApproval:true}).eligible,true)
})

// lineage and lifecycle
test('createEvolutionCandidate binds asset snapshot hash and lineage', () => {
  const r = rule('validated','0.1.0')
  const c = createEvolutionCandidate({assetSnapshot:r,generation:0,lifecycle:'validated',operator:{kind:'distillation',name:'initial-real-evidence'},sourceEpisodeSha256:[H('a')],createdAt:'2026-08-27T00:00:00Z'})
  assert.equal(c.asset.sha256,hashExperienceAsset(r))
  assert.equal(validateEvolutionCandidate(c).valid,true)
})
test('ledger rejects unknown parents', () => {
  const c = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'1',sha256:H('a')},generation:1,parentCandidateIds:['candidate_00000000000000000000'],operator:{kind:'mutation',name:'x'}})
  assert.throws(() => buildEvolutionLedger([c]),/Unknown parent/)
})
test('ledger lifecycle transition candidate -> qualified -> validated', () => {
  const c = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'1',sha256:H('a')},generation:0,operator:{kind:'manual',name:'seed'}})
  let ledger = buildEvolutionLedger([c])
  ledger = applyEvolutionTransition(ledger,{candidateId:c.candidateId,to:'qualified',reason:'qualification-pass'})
  ledger = applyEvolutionTransition(ledger,{candidateId:c.candidateId,to:'validated',reason:'promotion-pass'})
  assert.equal(ledger.activeValidatedCandidateId,c.candidateId)
})
test('ledger rejects invalid lifecycle transition', () => {
  const c = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'1',sha256:H('a')},generation:0,operator:{kind:'manual',name:'seed'}})
  assert.throws(() => buildEvolutionLedger([c],[{candidateId:c.candidateId,to:'validated',reason:'skip qualification'}]),/not allowed/)
})
test('lineage enforces generation increase', () => {
  const root = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'1',sha256:H('a')},generation:0,operator:{kind:'manual',name:'seed'}})
  const child = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'2',sha256:H('b')},generation:0,parentCandidateIds:[root.candidateId],operator:{kind:'mutation',name:'bad-generation'}})
  assert.throws(() => buildEvolutionLedger([root,child]),/generation must increase/)
})

// ranking, convergence, rollback / restore-best
function reviewFor(assetId, version, fitness, eligible=true) {
  return {schema:'ppl.experience-promotion-review/0.2',reviewId:`review_${version}`,asset:{assetType:'rule',assetId,version},policyId:'p',riskClass:'L1',decision:eligible?'eligible':'hold',eligible,reasons:[],evidence:{},hardGates:{},objectives:[],fitnessScore:fitness,humanApproval:{required:false,provided:false},reviewedAt:'2026-08-27T00:00:00Z'}
}
test('candidate ranking is deterministic by fitness then generation', () => {
  const a = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'1',sha256:H('a')},generation:0,lifecycle:'qualified',operator:{kind:'manual',name:'a'}})
  const b = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'2',sha256:H('b')},generation:1,lifecycle:'qualified',parentCandidateIds:[a.candidateId],operator:{kind:'mutation',name:'b'}})
  const ranked = rankEvolutionCandidates([a,b],{[a.candidateId]:reviewFor('r','1',0.2),[b.candidateId]:reviewFor('r','2',0.4)})
  assert.equal(ranked[0].candidateId,b.candidateId)
})
test('convergence detects patience without material improvement', () => {
  const out = detectEvolutionConvergence([{generation:0,fitnessScore:0.4},{generation:1,fitnessScore:0.405},{generation:2,fitnessScore:0.406},{generation:3,fitnessScore:0.407}],{patience:3,minImprovement:0.01})
  assert.equal(out.converged,true)
})
test('convergence continues after material improvement', () => {
  const out = detectEvolutionConvergence([{generation:0,fitnessScore:0.4},{generation:1,fitnessScore:0.42},{generation:2,fitnessScore:0.421}],{patience:2,minImprovement:0.01})
  assert.equal(out.converged,false)
})
test('restore-best can roll back current validated candidate to superseded predecessor', () => {
  const root0 = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'1',sha256:H('a')},generation:0,lifecycle:'superseded',operator:{kind:'manual',name:'root'}})
  const current0 = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'2',sha256:H('b')},generation:1,lifecycle:'validated',parentCandidateIds:[root0.candidateId],operator:{kind:'mutation',name:'child'}})
  const ledger = buildEvolutionLedger([root0,current0])
  const plan = planRestoreBest(ledger,{[root0.candidateId]:reviewFor('r','1',0.6),[current0.candidateId]:reviewFor('r','2',0.3)},current0.candidateId)
  assert.equal(plan.action,'restore-best')
  assert.equal(plan.targetCandidateId,root0.candidateId)
  let restored = ledger
  for (const transition of plan.transitions) restored = applyEvolutionTransition(restored,transition)
  assert.equal(restored.activeValidatedCandidateId,root0.candidateId)
  assert.equal(restored.statusByCandidateId[current0.candidateId],'rolled-back')
})
test('restore-best keeps current when current has best fitness', () => {
  const root = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'1',sha256:H('a')},generation:0,lifecycle:'superseded',operator:{kind:'manual',name:'root'}})
  const current = createEvolutionCandidate({asset:{assetType:'rule',assetId:'r',version:'2',sha256:H('b')},generation:1,lifecycle:'validated',parentCandidateIds:[root.candidateId],operator:{kind:'mutation',name:'child'}})
  const ledger = buildEvolutionLedger([root,current])
  const plan = planRestoreBest(ledger,{[root.candidateId]:reviewFor('r','1',0.2),[current.candidateId]:reviewFor('r','2',0.5)},current.candidateId)
  assert.equal(plan.action,'keep-current')
})

test('promotion function refuses candidate asset hash mismatch', () => {
  const r = rule('candidate','0.2.0-candidate.1')
  const c = createEvolutionCandidate({asset:{assetType:'rule',assetId:r.ruleId,version:r.version,sha256:H('f')},generation:1,operator:{kind:'mutation',name:'x'}})
  assert.throws(() => promoteRuleCandidate(r,c,reviewFor(r.ruleId,r.version,0.5)),/hash mismatch/)
})
test('promotion function promotes exactly reviewed candidate asset', () => {
  const r = rule('candidate','0.2.0-candidate.1')
  const c = createEvolutionCandidate({assetSnapshot:r,generation:1,operator:{kind:'mutation',name:'x'}})
  const promoted = promoteRuleCandidate(r,c,reviewFor(r.ruleId,r.version,0.5),{promotedAt:'2026-08-27T00:00:00Z'})
  assert.equal(promoted.status,'validated')
  assert.equal(promoted.validation.evolutionGovernance.candidateId,c.candidateId)
})
