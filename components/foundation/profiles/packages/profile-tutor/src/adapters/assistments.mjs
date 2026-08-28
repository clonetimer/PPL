import { canonicalSkillKey } from '../index.mjs'

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toBool(value) {
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false
  return undefined
}


function normalizeFirstAction(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === '0' || raw === 'attempt' || raw === 'answer') return 'attempt'
  if (raw === '1' || raw === 'hint') return 'hint'
  if (raw === '2' || raw === 'scaffolding' || raw === 'scaffold') return 'scaffolding'
  return raw || null
}

function firstPresent(row, keys) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return undefined
}

export function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const parseLine = line => {
    const out = []
    let current = ''
    let quoted = false
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i]
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i += 1 } else quoted = !quoted
      } else if (c === ',' && !quoted) { out.push(current); current = '' } else current += c
    }
    out.push(current)
    return out
  }
  const headers = parseLine(lines[0]).map(x => x.trim())
  return lines.slice(1).map(line => {
    const values = parseLine(line)
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  })
}

export function assistmentsRowToEvent(row, options = {}) {
  const skillId = firstPresent(row, ['skill_name', 'skill', 'skill_id', 'knowledge_component']) || 'skill-unknown'
  const correct = toBool(row.correct)
  const attempts = Math.max(1, toNumber(firstPresent(row, ['attempt_count', 'attempts']), 1))
  const hintCount = Math.max(0, toNumber(firstPresent(row, ['hint_count', 'hints']), 0))
  const hintTotal = Math.max(0, toNumber(row.hint_total, 0))
  const original = toBool(row.original)
  const bottomHint = toBool(row.bottom_hint)
  const firstActionRaw = firstPresent(row, ['first_action'])
  const firstAction = normalizeFirstAction(firstActionRaw)
  const answerRevealed = toBool(row.answer_revealed) === true || bottomHint === true
  const orderId = firstPresent(row, ['order_id', 'problem_log_id', 'id']) || `${row.user_id || 'u'}:${row.problem_id || 'p'}:${options.index ?? 0}`
  return {
    id: `assistments:${orderId}`,
    type: 'LEARNER_OBSERVATION',
    category: 'knowledge-tracing',
    payload: {
      evidenceId: `assistments:${orderId}`,
      learnerId: row.user_id || null,
      skillId: String(skillId),
      skillKey: canonicalSkillKey(skillId),
      problemId: row.problem_id || null,
      correct,
      sourceReliability: original === false ? 0.72 : 0.90,
      assessment: {
        source: 'ASSISTments-2009-2010-skill-builder',
        original,
        firstAttempt: attempts <= 1,
        attemptCount: attempts,
        hintCount,
        hintTotal,
        firstAction,
        firstActionRaw: firstActionRaw ?? null,
        bottomHint: bottomHint ?? null,
        answerRevealed,
      },
      provenance: {
        dataset: 'ASSISTments 2009-2010 Skill Builder',
        datasetVariant: 'corrected-collapsed-compatible',
        rowId: String(orderId),
        userId: row.user_id || null,
        problemId: row.problem_id || null,
        documentedColumns: true,
      },
    },
  }
}

function rowOrder(row, fallback) {
  const value = Number(row.order_id)
  return Number.isFinite(value) ? value : fallback
}

function selectRows(rows, options = {}) {
  const userId = options.userId === undefined || options.userId === null ? null : String(options.userId)
  const skillId = options.skillId === undefined || options.skillId === null ? null : String(options.skillId)
  const maxRows = options.maxRows === undefined ? Infinity : Math.max(0, Number(options.maxRows) || 0)
  const originalOnly = options.originalOnly === true

  const selected = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !userId || String(row.user_id) === userId)
    .filter(({ row }) => {
      if (!skillId) return true
      const skill = firstPresent(row, ['skill_name', 'skill', 'skill_id', 'knowledge_component'])
      return String(skill ?? '') === skillId
    })
    .filter(({ row }) => !originalOnly || toBool(row.original) === true)
    .sort((a, b) => rowOrder(a.row, a.index) - rowOrder(b.row, b.index) || a.index - b.index)
  return Number.isFinite(maxRows) ? selected.slice(0, maxRows) : selected
}

export function summarizeAssistmentsRows(rows) {
  const users = new Map()
  const skills = new Map()
  let validOutcomes = 0
  let hintedRows = 0
  let scaffoldingRows = 0
  let multipleAttemptRows = 0
  let bottomHintRows = 0
  let firstActionHintRows = 0
  for (const row of rows) {
    const user = String(row.user_id || 'unknown')
    const skill = String(firstPresent(row, ['skill_name', 'skill', 'skill_id', 'knowledge_component']) || 'unknown')
    users.set(user, (users.get(user) || 0) + 1)
    skills.set(skill, (skills.get(skill) || 0) + 1)
    if (toBool(row.correct) !== undefined) validOutcomes += 1
    const hints = toNumber(firstPresent(row, ['hint_count', 'hints']), 0)
    const attempts = toNumber(firstPresent(row, ['attempt_count', 'attempts']), 1)
    const firstAction = normalizeFirstAction(firstPresent(row, ['first_action']))
    if (hints > 0 || firstAction === 'hint') hintedRows += 1
    if (attempts > 1) multipleAttemptRows += 1
    if (toBool(row.bottom_hint) === true) bottomHintRows += 1
    if (firstAction === 'hint') firstActionHintRows += 1
    if (toBool(row.original) === false) scaffoldingRows += 1
  }
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([id, rows]) => ({ id, rows }))
  return {
    rows: rows.length,
    users: users.size,
    skills: skills.size,
    validOutcomes,
    hintedRows,
    multipleAttemptRows,
    bottomHintRows,
    firstActionHintRows,
    scaffoldingRows,
    topUsers: top(users),
    topSkills: top(skills),
  }
}

export function summarizeAssistmentsCsv(text) {
  return summarizeAssistmentsRows(parseCsv(text))
}

export function assistmentsCsvToScenario(text, options = {}) {
  const rows = parseCsv(text)
  const selected = selectRows(rows, options)
  return {
    id: options.id || 'assistments-import',
    source: {
      kind: 'dataset-adapter',
      dataset: 'ASSISTments 2009-2010 Skill Builder',
      variant: 'corrected-collapsed-compatible',
      note: options.note || 'Adapter consumes documented ASSISTments columns. Input rows remain Host-owned evidence; Profile does not infer hidden action sequences that are absent from the dataset.',
      selection: {
        userId: options.userId ?? null,
        skillId: options.skillId ?? null,
        originalOnly: options.originalOnly === true,
        maxRows: Number.isFinite(Number(options.maxRows)) ? Number(options.maxRows) : null,
        selectedRows: selected.length,
        sourceRows: rows.length,
      },
    },
    steps: selected.map(({ row, index }, selectedIndex) => ({
      turn: selectedIndex + 1,
      event: assistmentsRowToEvent(row, { index }),
      endReason: 'completed',
    })),
  }
}
