#!/usr/bin/env node
import fs from 'node:fs'
import {
  validateAgentContract, compileGovernance, evaluateDelegation, projectContext,
  buildHandoffEnvelope, assessInformationFidelity, buildGovernedHandoff,
  buildSemanticFidelityJudgeRequest, finalizeFidelityAssessment,
  buildDeliveryFidelityJudgeRequest, finalizeDeliveryFidelityAssessment, buildFidelityRecoveryPlan,
  buildDeliveryEvidenceBinding, buildBoundDeliveryFidelityJudgeRequest, finalizeBoundDeliveryFidelityAssessment, renderGovernedDelivery,
} from '../src/index.mjs'

const [command, inputPath] = process.argv.slice(2)
const raw = inputPath ? fs.readFileSync(inputPath, 'utf8') : fs.readFileSync(0, 'utf8')
const input = JSON.parse(raw)
let output
switch (command) {
  case 'validate-agent': output = validateAgentContract(input); break
  case 'delegate': output = evaluateDelegation(compileGovernance(input.contracts), input.request); break
  case 'project': output = projectContext(compileGovernance(input.contracts), input.request); break
  case 'handoff': output = buildHandoffEnvelope(input); break
  case 'governed-handoff': output = buildGovernedHandoff(compileGovernance(input.contracts), input.request); break
  case 'fidelity': output = assessInformationFidelity(input); break
  case 'semantic-judge-request': output = buildSemanticFidelityJudgeRequest(input); break
  case 'finalize-fidelity': output = finalizeFidelityAssessment(input.structuralReport, input.semanticJudgeResult); break
  case 'delivery-judge-request': output = buildDeliveryFidelityJudgeRequest(input); break
  case 'finalize-delivery': output = finalizeDeliveryFidelityAssessment(input.structuralReport, input.deliveryJudgeResult); break
  case 'delivery-binding': output = buildDeliveryEvidenceBinding(input); break
  case 'bound-delivery-judge-request': output = buildBoundDeliveryFidelityJudgeRequest(input); break
  case 'finalize-bound-delivery': output = finalizeBoundDeliveryFidelityAssessment(input.structuralReport, input.binding, input.deliveryJudgeResult); break
  case 'render-governed-delivery': output = renderGovernedDelivery(input); break
  case 'recovery-plan': output = buildFidelityRecoveryPlan(input); break
  default:
    console.error('Usage: ppl-mag <validate-agent|delegate|project|handoff|governed-handoff|fidelity|semantic-judge-request|finalize-fidelity|delivery-judge-request|finalize-delivery|delivery-binding|bound-delivery-judge-request|finalize-bound-delivery|render-governed-delivery|recovery-plan> [input.json]')
    process.exit(2)
}
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
