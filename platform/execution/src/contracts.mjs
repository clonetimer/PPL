export const MAG_CLAIM_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['claimId','canonicalText','status','polarity','confidence','sourceRefs','assertedBy','sensitivity','requiredForDecision','conflictSetId','derivedFrom','authorityScope'],
  properties: {
    claimId: { type: 'string' },
    canonicalText: { type: 'string', minLength: 1, maxLength: 50000 },
    status: { type: 'string' },
    polarity: { type: 'string', enum: ['support','oppose','neutral'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sourceRefs: { type: 'array', items: { type: 'string' } },
    assertedBy: { type: 'string' },
    sensitivity: { type: 'string' },
    requiredForDecision: { type: 'boolean' },
    conflictSetId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    derivedFrom: { type: 'array', items: { type: 'string' } },
    authorityScope: { type: 'string' },
  },
}

export const HANDOFF_RECEIVER_RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schema','message','claims'],
  properties: {
    schema: { type: 'string', enum: ['ppl.product.handoff-receiver-response/1'] },
    message: { type: 'string' },
    claims: { type: 'array', items: MAG_CLAIM_JSON_SCHEMA },
  },
}

export const RESEARCH_EVIDENCE_EXTRACTION_RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schema','relevant','canonicalText','polarity','confidence','rationale'],
  properties: {
    schema: { type: 'string', enum: ['ppl.product.research-evidence-extraction/1'] },
    relevant: { type: 'boolean' },
    canonicalText: { type: 'string', maxLength: 50000 },
    polarity: { type: 'string', enum: ['support','oppose','neutral'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
  },
}

export const RESEARCH_REVIEW_RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schema','derivedConclusion','claims'],
  properties: {
    schema: { type: 'string', enum: ['ppl.product.research-review-response/1'] },
    derivedConclusion: { type: 'string', minLength: 1, maxLength: 50000 },
    claims: { type: 'array', items: MAG_CLAIM_JSON_SCHEMA },
  },
}

export const BOUND_DELIVERY_JUDGE_RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schema','handoffId','bindingId','pass','counterEvidenceIntegrated','uncertaintyCalibrated','attributionPreservation','metricScopePreservation','conclusionSupported','noNovelFacts','findings'],
  properties: {
    schema: { type: 'string', enum: ['ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1'] },
    handoffId: { type: 'string' },
    bindingId: { type: 'string' },
    pass: { type: 'boolean' },
    counterEvidenceIntegrated: { type: 'boolean' },
    uncertaintyCalibrated: { type: 'boolean' },
    attributionPreservation: { type: 'boolean' },
    metricScopePreservation: { type: 'boolean' },
    conclusionSupported: { type: 'boolean' },
    noNovelFacts: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
  },
}
