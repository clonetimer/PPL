#!/usr/bin/env node
import fs from 'node:fs'
import { buildPromotionPolicy, reviewPromotionCandidate } from '../src/index.mjs'

const [evaluationsFile, policyFile, outputFile] = process.argv.slice(2)
if (!evaluationsFile || !policyFile) {
  console.error('usage: ppl-experience-evolution-review <evaluations.json> <policy.json> [output.json]')
  process.exit(2)
}
const evaluations = JSON.parse(fs.readFileSync(evaluationsFile, 'utf8'))
const policyInput = JSON.parse(fs.readFileSync(policyFile, 'utf8'))
const policy = policyInput.schema ? policyInput : buildPromotionPolicy(policyInput)
const review = reviewPromotionCandidate(evaluations, policy, {
  humanApproval: process.env.PPL_EXPERIENCE_HUMAN_APPROVAL === '1',
})
const text = JSON.stringify(review, null, 2) + '\n'
if (outputFile) fs.writeFileSync(outputFile, text)
process.stdout.write(text)
process.exit(review.eligible ? 0 : 1)
