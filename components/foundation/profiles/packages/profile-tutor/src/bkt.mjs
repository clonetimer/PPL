const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value)))
const round = (value, digits = 4) => Number(Number(value).toFixed(digits))

/**
 * Minimal two-state Bayesian Knowledge Tracing reference.
 * This is intentionally a sanity baseline, not the PPL Tutor state model.
 * ASSISTments `correct` is treated as first-attempt correctness/help outcome.
 */
export function bktStep(priorKnown, correct, parameters = {}) {
  const pKnown = clamp(priorKnown)
  const pLearn = clamp(parameters.pLearn ?? 0.10)
  const pGuess = clamp(parameters.pGuess ?? 0.20)
  const pSlip = clamp(parameters.pSlip ?? 0.10)
  const observed = Boolean(correct)
  const likelihoodKnown = observed ? (1 - pSlip) : pSlip
  const likelihoodUnknown = observed ? pGuess : (1 - pGuess)
  const denominator = pKnown * likelihoodKnown + (1 - pKnown) * likelihoodUnknown
  const posterior = denominator > 0 ? (pKnown * likelihoodKnown) / denominator : pKnown
  const nextKnown = posterior + (1 - posterior) * pLearn
  return {
    priorKnown: round(pKnown),
    observedCorrect: observed,
    posteriorKnown: round(posterior),
    nextKnown: round(nextKnown),
    parameters: { pLearn: round(pLearn), pGuess: round(pGuess), pSlip: round(pSlip) },
  }
}

export function runBktTrace(observations = [], parameters = {}) {
  let pKnown = clamp(parameters.pInit ?? 1 / 3)
  const steps = []
  for (const observation of observations) {
    const raw = observation?.correct ?? observation?.payload?.correct
    if (raw === undefined || raw === null) continue
    const correct = raw === true || raw === 1 || raw === '1' || String(raw).toLowerCase() === 'true'
    const row = bktStep(pKnown, correct, parameters)
    steps.push({ ...row, id: observation?.id || observation?.evidenceId || observation?.payload?.evidenceId || null })
    pKnown = row.nextKnown
  }
  return {
    schema: 'ppl.tutor-bkt-sanity/0.1',
    role: 'advisory-reference-only',
    startKnown: round(parameters.pInit ?? 1 / 3),
    finalKnown: round(pKnown),
    observations: steps.length,
    steps,
  }
}

function ranks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const out = Array(values.length)
  for (let i = 0; i < sorted.length;) {
    let j = i + 1
    while (j < sorted.length && sorted[j].value === sorted[i].value) j += 1
    const rank = (i + j - 1) / 2 + 1
    for (let k = i; k < j; k += 1) out[sorted[k].index] = rank
    i = j
  }
  return out
}

export function spearmanCorrelation(a = [], b = []) {
  if (a.length !== b.length || a.length < 2) return null
  const ra = ranks(a)
  const rb = ranks(b)
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length
  const mb = rb.reduce((x, y) => x + y, 0) / rb.length
  let num = 0; let da = 0; let db = 0
  for (let i = 0; i < ra.length; i += 1) {
    const xa = ra[i] - ma; const xb = rb[i] - mb
    num += xa * xb; da += xa * xa; db += xb * xb
  }
  const den = Math.sqrt(da * db)
  return den ? round(num / den) : null
}

export function compareTutorToBkt(rows = [], options = {}) {
  const comparable = rows.filter(row => Number.isFinite(Number(row?.pplFinal)) && Number.isFinite(Number(row?.bktFinal)))
  const rho = spearmanCorrelation(comparable.map(x => Number(x.pplFinal)), comparable.map(x => Number(x.bktFinal)))
  const severe = []
  for (const row of comparable) {
    const ppl = Number(row.pplFinal); const bkt = Number(row.bktFinal)
    if (Math.abs(ppl - bkt) >= Number(options.severeGap ?? 0.60)) severe.push({ id: row.id, code: 'TUTOR_BKT_SEVERE_GAP', ppl, bkt })
    if (row.allCorrect && ppl <= Number(row.pplStart ?? 1 / 3)) severe.push({ id: row.id, code: 'TUTOR_ALL_CORRECT_NONINCREASING', ppl })
    if (row.allIncorrect && ppl >= Number(row.pplStart ?? 1 / 3)) severe.push({ id: row.id, code: 'TUTOR_ALL_INCORRECT_NONDECREASING', ppl })
  }
  if (rho !== null && comparable.length >= 5 && rho < Number(options.minSpearman ?? -0.25)) severe.push({ code: 'TUTOR_BKT_ANTICORRELATED', rho })
  return {
    schema: 'ppl.tutor-bkt-comparison/0.1',
    role: 'sanity-check-not-calibration-claim',
    traces: comparable.length,
    spearman: rho,
    severeAnomalies: severe,
    passed: severe.length === 0,
  }
}
