import {
  activeRules, causalChain, defaultMetrics, entityMeta, eventLabel, flatten, makeEvidenceBundle,
  mutationStatus, mutations, normalizeSession, ruleImpacts, ruleStatistics, series, sessionDiagnostics,
  sessionOverview, snapshotDiff, stateGroups, validateSession, domainKind, tutorDomainSummary, researchDomainSummary,
  lifecycleOverview, lifecycleTurnTimeline, lifecycleToolSummary, lifecycleRestartTimeline,
} from '@ppl/app-core'

const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = value => typeof value === 'number' ? Number.isInteger(value) ? String(value) : value.toFixed(2) : value === undefined ? '—' : value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const statusText = status => status === 'applied' ? '已提交' : status === 'discarded' ? '已回滚' : '待提交'
const severityText = severity => severity === 'error' ? '错误' : severity === 'warning' ? '警告' : severity === 'info' ? '信息' : severity || '信息'

function sparkline(points, metric = {}) {
  const numeric = points.filter(p => typeof p.value === 'number')
  if (!numeric.length) return '<div class="ppl-spark-empty">暂无数值轨迹</div>'
  const values = numeric.map(p => p.value)
  const min = typeof metric.min === 'number' ? metric.min : Math.min(...values)
  const max = typeof metric.max === 'number' ? metric.max : Math.max(...values)
  const span = max - min || 1
  const x = i => 10 + i * (220 / Math.max(1, numeric.length - 1))
  const y = value => 52 - ((value - min) / span) * 40
  const coords = numeric.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')
  return `<svg viewBox="0 0 240 62" class="ppl-spark" aria-label="${esc(metric.label || metric.path)} 状态轨迹"><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${numeric.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.value)}" r="4" class="${p.status}"><title>T${p.turn}.${p.step}: ${p.value}</title></circle>`).join('')}</svg>`
}

function metricCard(metric, entries, current) {
  const points = series(entries, metric.path)
  const currentPoint = [...points].reverse().find(p => p.turn === current.snapshot.host.turn && p.step === current.snapshot.host.step) || points.at(-1)
  const value = currentPoint?.value
  const bool = typeof value === 'boolean'
  return `<article class="ppl-metric-card"><div class="ppl-metric-head"><span>${esc(metric.label || metric.path)}</span><code>${esc(metric.path)}</code></div><div class="ppl-metric-value ${bool ? (value ? 'on' : 'off') : ''}">${bool ? (value ? '是' : '否') : esc(fmt(value))}</div><div class="ppl-metric-hint">${esc(metric.hint || '')}</div>${bool ? '<div class="ppl-boolean-track"><span></span></div>' : sparkline(points, metric)}</article>`
}

function overviewTab(session, entry, selected) {
  const entries = session.entries
  const summary = sessionOverview(session)
  const metrics = defaultMetrics(session)
  const meta = entityMeta(entry)
  const chain = causalChain(entry)
  const prev = selected > 0 ? entries[selected - 1] : undefined
  const diff = snapshotDiff(entry, prev)
  return `
    <section class="ppl-kpi-grid">
      <article><span>Snapshots</span><strong>${summary.snapshots}</strong><small>${summary.statuses.applied} 提交 · ${summary.statuses.discarded} 回滚</small></article>
      <article><span>Rules</span><strong>${summary.uniqueRules}</strong><small>Session 内唯一命中规则</small></article>
      <article><span>State Changes</span><strong>${summary.changedPaths}</strong><small>跨 Snapshot 状态变化</small></article>
      <article><span>Diagnostics</span><strong class="${summary.diagnostics ? 'warn' : 'ok'}">${summary.diagnostics}</strong><small>${summary.diagnostics ? '需要关注' : '未发现异常'}</small></article>
    </section>
    <section class="ppl-metrics-grid">${metrics.map(metric => metricCard(metric, entries, entry)).join('') || '<div class="ppl-empty">该 Session 没有可观测指标配置。</div>'}</section>
    <section class="ppl-two-col">
      <article class="ppl-panel"><header><div><span class="ppl-eyebrow">CURRENT ENTITY</span><h3>${esc(meta.title)}</h3></div><span class="ppl-kind ${meta.kind}">${meta.kind === 'profile' ? 'Profile' : 'Persona'}</span></header><div class="ppl-summary-list"><div><span>ID</span><code>${esc(meta.id)}</code></div><div><span>版本</span><b>${esc(meta.version || '—')}</b></div><div><span>Event</span><b>${esc(eventLabel(entry))}</b></div><div><span>本轮状态</span><b class="ppl-status-text ${mutationStatus(entry)}">${statusText(mutationStatus(entry))}</b></div></div></article>
      <article class="ppl-panel"><header><div><span class="ppl-eyebrow">CURRENT CAUSAL CHAIN</span><h3>本轮因果链</h3></div><small>${chain.rules.length} rules</small></header><div class="ppl-causal-mini"><div class="node event">${esc(entry.snapshot.event?.type || 'UNKNOWN')}</div><div class="arrow">→</div><div class="rule-stack">${chain.rules.map(r=>`<span>${esc(r.id)}</span>`).join('') || '<span>无规则</span>'}</div><div class="arrow">→</div><div class="path-stack">${[...new Set(chain.mutations.map(m=>m.path))].slice(0,4).map(p=>`<code>${esc(p)}</code>`).join('') || diff.slice(0,4).map(d=>`<code>${esc(d.path)}</code>`).join('') || '<code>无状态变化</code>'}</div></div></article>
    </section>`
}

function snapshotTab(session, entry, selected) {
  const prev = selected > 0 ? session.entries[selected - 1] : undefined
  const diff = snapshotDiff(entry, prev)
  const muts = mutations(entry)
  const groups = stateGroups(session, entry)
  return `
    <section class="ppl-two-col ppl-snapshot-top">
      <article class="ppl-panel"><header><div><span class="ppl-eyebrow">TRANSACTION</span><h3>Commit / Transition</h3></div><span class="ppl-pill ${mutationStatus(entry)}">${statusText(mutationStatus(entry))}${entry.endReason ? ` · ${esc(entry.endReason)}` : ''}</span></header><div class="ppl-mutations">${muts.map(m=>`<div><div><b>${esc(m.source)}</b><code>${esc(m.path)}</code></div><div><span>${esc(fmt(m.from))}</span><i>→</i><strong>${esc(fmt(m.to))}</strong><em class="${m.status}">${statusText(m.status)}</em></div></div>`).join('') || '<div class="ppl-empty">本轮没有持久化变更。</div>'}</div></article>
      <article class="ppl-panel"><header><div><span class="ppl-eyebrow">DIFF</span><h3>与上一个 Snapshot 的差异</h3></div><strong>${diff.length}</strong></header><div class="ppl-diff-list">${diff.slice(0,12).map(d=>`<div class="${d.kind}"><code>${esc(d.path)}</code><span>${esc(fmt(d.before))}</span><i>→</i><strong>${esc(fmt(d.after))}</strong></div>`).join('') || '<div class="ppl-empty">基线 Snapshot 或无状态变化。</div>'}</div></article>
    </section>
    <section class="ppl-state-groups">${groups.map(group=>`<article class="ppl-panel"><header><div><span class="ppl-eyebrow">STATE GROUP</span><h3>${esc(group.label || group.id)}</h3></div><small>${group.rows.length} fields</small></header><div class="ppl-state-table">${group.rows.map(row=>`<div><code>${esc(row.path)}</code><b>${esc(fmt(row.value))}</b></div>`).join('') || '<div class="ppl-empty">无字段</div>'}</div></article>`).join('')}</section>`
}

function rulesTab(session, entry) {
  const stats = ruleStatistics(session)
  const impacts = ruleImpacts(entry)
  const chain = causalChain(entry)
  return `
    <section class="ppl-panel"><header><div><span class="ppl-eyebrow">SESSION RULE STATISTICS</span><h3>规则命中统计</h3></div><small>${stats.length} unique rules</small></header><div class="ppl-rule-table"><div class="head"><span>规则</span><span>命中</span><span>提交</span><span>回滚</span><span>影响路径</span></div>${stats.map(r=>`<div><b>${esc(r.id)}</b><span>${r.hits}</span><span class="ok">${r.applied}</span><span class="danger">${r.discarded}</span><span>${r.paths.length}</span></div>`).join('') || '<div class="ppl-empty">没有规则命中。</div>'}</div></section>
    <section class="ppl-two-col">
      <article class="ppl-panel"><header><div><span class="ppl-eyebrow">CURRENT RULE IMPACT</span><h3>本轮 Rule → Path</h3></div></header><div class="ppl-rule-cards">${impacts.map(r=>`<div class="ppl-rule-card"><div><b>${esc(r.id)}</b><span>${r.priority === undefined ? '' : `P${r.priority}`}</span></div><div>${r.paths.map(p=>`<code>${esc(p)}</code>`).join('') || '<small>无 touched path</small>'}</div><small>${r.provenance} provenance · ${r.mutations} mutation</small></div>`).join('') || '<div class="ppl-empty">本轮没有规则影响。</div>'}</div></article>
      <article class="ppl-panel"><header><div><span class="ppl-eyebrow">CAUSAL TRACE</span><h3>Event → Rule → Mutation</h3></div></header><div class="ppl-causal-full"><div class="node event">${esc(chain.event.type || 'UNKNOWN')}</div>${chain.rules.map(rule=>`<div class="ppl-chain-row"><i>→</i><div class="node rule"><b>${esc(rule.id)}</b>${rule.paths.map(p=>`<code>${esc(p)}</code>`).join('')}</div></div>`).join('') || '<div class="ppl-empty">本轮没有 active rule。</div>'}${chain.mutations.map(m=>`<div class="ppl-chain-row mutation"><i>↳</i><div><code>${esc(m.path)}</code><span>${esc(fmt(m.from))} → <b>${esc(fmt(m.to))}</b></span></div></div>`).join('')}</div></article>
    </section>`
}


function domainTab(session, entry) {
  const kind = domainKind(session, entry)
  if (kind === 'tutor') {
    const d = tutorDomainSummary(entry)
    const trajectory = tutorLearnerTrajectory(session)
    const m = d.model || {}
    const misconceptions = d.misconceptions || []
    const a = d.evidenceAccounting || {}
    const last = d.latestEvidence || {}
    return `<section class="ppl-domain-hero tutor"><div><span class="ppl-eyebrow">TUTOR MODEL</span><h3>${esc(d.skillId || '未选择技能')}</h3><p>把“独立成功”“首答失败”“使用帮助”分开记账；帮助只削弱成功的掌握证据，不会抹除尚未独立掌握的负证据。</p></div><div class="ppl-domain-score"><strong>${esc(fmt(m.mean))}</strong><span>掌握度均值</span></div><div class="ppl-domain-score warn"><strong>${esc(fmt(m.uncertainty))}</strong><span>知识不确定性</span></div></section>
    <section class="ppl-kpi-grid domain-kpi"><article><span>有效证据量</span><strong>${esc(fmt(m.evidenceWeight))}</strong><small>${esc(a.observations || 0)} observations</small></article><article><span>独立首答成功</span><strong>${esc(a.unaidedSuccesses || 0)}</strong><small>${esc(a.directAssessments || 0)} direct observations</small></article><article><span>首答失败</span><strong>${esc(a.firstAttemptFailures || 0)}</strong><small>${esc(a.assistanceEpisodes || 0)} assistance episodes</small></article><article><span>最近证据方向</span><strong class="text-value ${esc(last.direction || '')}">${esc(last.direction || '—')}</strong><small>weight ${esc(fmt(last.weight))} · ${esc(last.reason || '')}</small></article></section>
    <section class="ppl-kpi-grid domain-kpi"><article><span>Policy</span><strong class="text-value">${esc(d.policy.mode || '—')}</strong><small>${esc(d.policy.reason || '')}</small></article><article><span>Hint Level</span><strong>${esc(fmt(d.policy.hintLevel))}</strong><small>推荐难度 ${esc(fmt(d.policy.recommendedDifficulty))}</small></article><article><span>Verifier</span><strong>${esc(fmt(d.verifier.effectiveness))}</strong><small>${esc(d.verifier.verified || 0)} verified turns</small></article><article><span>Skills</span><strong>${esc(trajectory.summary.skills)}</strong><small>${esc(trajectory.summary.points)} trajectory points</small></article></section>
    <section class="ppl-panel ppl-trajectory-panel"><header><div><span class="ppl-eyebrow">LEARNER TRAJECTORY</span><h3>学习状态轨迹</h3></div><small>${trajectory.summary.assistedPoints} assisted points</small></header><div class="ppl-trajectory-table tutor"><div class="head"><span>T.S</span><span>Skill</span><span>Mastery</span><span>Uncertainty</span><span>Evidence</span><span>Weight</span><span>Assistance</span></div>${trajectory.points.map(p=>`<div><code>T${esc(p.turn)}.${esc(p.step)}</code><b>${esc(p.skillId)}</b><span>${esc(fmt(p.mean))}</span><span>${esc(fmt(p.uncertainty))}</span><span class="trajectory-direction ${esc(p.evidence?.direction || '')}">${esc(p.evidence?.direction || '—')}</span><span>${esc(fmt(p.evidence?.weight))}</span><span>${p.evidence?.assistanceUsed ? `是 · h${esc(p.evidence.hints || 0)} / a${esc(p.evidence.attempts || 1)}` : '否'}</span></div>`).join('') || '<div class="ppl-empty">尚无学习轨迹。</div>'}</div></section>
    <section class="ppl-two-col"><article class="ppl-panel"><header><div><span class="ppl-eyebrow">FINAL SKILL STATES</span><h3>各技能最终状态</h3></div><small>${trajectory.skills.length}</small></header><div class="ppl-domain-list">${trajectory.skills.map(x=>`<div><div><b>${esc(x.skillId)}</b><small>${esc(x.observations)} observations</small></div><div><span>mean ${esc(fmt(x.finalMean))}</span><span>uncertainty ${esc(fmt(x.finalUncertainty))}</span><strong>${esc(fmt(x.evidenceWeight))}</strong></div></div>`).join('') || '<div class="ppl-empty">尚无技能状态。</div>'}</div></article><article class="ppl-panel"><header><div><span class="ppl-eyebrow">MISCONCEPTION EVIDENCE</span><h3>错误概念证据</h3></div><small>${misconceptions.length}</small></header><div class="ppl-domain-list">${misconceptions.map(x=>`<div><div><b>${esc(x.id)}</b><small>${esc(x.status)}</small></div><div><span>support ${esc(fmt(x.support))}</span><span>contradiction ${esc(fmt(x.contradiction))}</span><strong>${esc(fmt(x.confidence))}</strong></div></div>`).join('') || '<div class="ppl-empty">尚无错误概念证据。</div>'}</div></article></section>
    <section class="ppl-panel"><header><div><span class="ppl-eyebrow">INTERVENTION VERIFIER</span><h3>教学干预与验证</h3></div></header><div class="ppl-summary-list"><div><span>最近干预</span><b>${esc(d.interventions.at(-1)?.strategy || '—')}</b></div><div><span>Progress</span><b>${esc(d.verifier.progress || 0)}</b></div><div><span>Neutral</span><b>${esc(d.verifier.neutral || 0)}</b></div><div><span>Regress</span><b>${esc(d.verifier.regress || 0)}</b></div></div></section>`
  }
  if (kind === 'research') {
    const d = researchDomainSummary(entry)
    const trajectory = researchClaimTrajectory(session, { claimId: d.activeClaimId })
    const c = d.claim || {}
    const decision = c.decision || {}
    const conflict = d.conflict || {}
    const direction = d.conclusionDirection || decision.direction || 'undetermined'
    const conclusionClass = decision.status === 'ready' ? 'applied' : decision.status === 'qualified' ? 'pending' : decision.status === 'inconclusive' ? 'conflict' : 'discarded'
    const conclusionText = decision.status === 'ready' ? (direction === 'oppose' ? 'ready · 反驳可报告' : 'ready · 支持可报告') : decision.status === 'qualified' ? `qualified · ${direction}` : decision.status === 'inconclusive' ? 'inconclusive · 混合证据未定' : 'blocked · 暂不可结论'
    return `<section class="ppl-domain-hero research"><div><span class="ppl-eyebrow">RESEARCH LEDGER</span><h3>${esc(c.text || d.question || '尚无 Active Claim')}</h3><p>${esc(d.question || '')}</p></div><div class="ppl-domain-score ${decision.status === 'inconclusive' ? 'conflict' : ''}"><strong>${esc(c.status || d.conclusionStatus || 'blocked')}</strong><span>结论成熟度</span></div><div class="ppl-domain-score ${direction === 'oppose' ? 'oppose' : direction === 'mixed' ? 'conflict' : ''}"><strong>${esc(direction)}</strong><span>结论方向</span></div></section>
    <section class="ppl-kpi-grid domain-kpi"><article><span>Support Mass</span><strong>${esc(fmt(c.supportMass))}</strong><small>${esc((c.supportGroups || []).length)} independent groups</small></article><article><span>Oppose Mass</span><strong>${esc(fmt(c.opposeMass))}</strong><small>${esc((c.opposeGroups || []).length)} opposing groups</small></article><article><span>Uncertainty</span><strong class="${Number(c.uncertainty || 0) > .45 ? 'warn' : ''}">${esc(fmt(c.uncertainty))}</strong><small>conflict ${esc(fmt(conflict.balanceRatio))}</small></article><article><span>Strong Validation</span><strong>${esc(Number(c.validation?.strongSupport || 0) + Number(c.validation?.strongOppose || 0))}</strong><small>${esc(c.validation?.strongSupport || 0)} support · ${esc(c.validation?.strongOppose || 0)} oppose</small></article></section>
    <section class="ppl-panel ppl-trajectory-panel"><header><div><span class="ppl-eyebrow">CLAIM TRAJECTORY</span><h3>结论状态 / 方向演化</h3></div><small>${trajectory.transitions.length} transitions</small></header><div class="ppl-transition-strip">${trajectory.transitions.map(t=>`<span><code>T${esc(t.turn)}.${esc(t.step)}</code> ${esc(t.from)} → <b>${esc(t.to)}</b></span>`).join('') || '<span class="ok">当前 Session 尚无结论状态迁移。</span>'}</div><div class="ppl-trajectory-table research"><div class="head"><span>T.S</span><span>Event</span><span>Status</span><span>Direction</span><span>Support</span><span>Oppose</span><span>Uncertainty</span><span>Strong S/O</span></div>${trajectory.points.map(p=>`<div><code>T${esc(p.turn)}.${esc(p.step)}</code><b>${esc(p.eventType)}</b><span class="trajectory-status ${esc(p.conclusionStatus)}">${esc(p.conclusionStatus)}</span><span class="trajectory-direction ${esc(p.conclusionDirection)}">${esc(p.conclusionDirection)}</span><span>${esc(fmt(p.supportMass))}</span><span>${esc(fmt(p.opposeMass))}</span><span>${esc(fmt(p.uncertainty))}</span><span>${esc(p.strongSupport)} / ${esc(p.strongOppose)}</span></div>`).join('') || '<div class="ppl-empty">尚无 Claim trajectory。</div>'}</div></section>
    <section class="ppl-two-col"><article class="ppl-panel"><header><div><span class="ppl-eyebrow">CONCLUSION GATE</span><h3>结论门禁</h3></div><span class="ppl-pill ${conclusionClass}">${esc(conclusionText)}</span></header><div class="ppl-summary-list"><div><span>Provenance</span><b>${c.provenanceComplete === false ? '不完整' : '完整'}</b></div><div><span>Independent Sources</span><b>${esc(c.independentSourceCount || 0)}</b></div><div><span>Direction</span><b class="trajectory-direction ${esc(direction)}">${esc(direction)}</b></div><div><span>Next Action</span><code>${esc(d.nextAction || '—')}</code></div></div><div class="ppl-reason-chips">${(decision.reasons || []).map(x=>`<span>${esc(x)}</span>`).join('') || '<span class="ok">全部门禁满足</span>'}</div></article><article class="ppl-panel"><header><div><span class="ppl-eyebrow">VALIDATION LEDGER</span><h3>验证记录</h3></div></header><div class="ppl-domain-list">${d.validationLedger.map(v=>`<div><div><b>${esc(v.method)}</b><small>${esc(v.validationId)}</small></div><div><span>${esc(v.outcome)}</span><span>${v.reproducible ? 'reproducible' : 'non-reproducible'}</span><strong>${esc(fmt(v.confidence))}</strong></div></div>`).join('') || '<div class="ppl-empty">尚无 validation。</div>'}</div></article></section>
    <section class="ppl-panel"><header><div><span class="ppl-eyebrow">EVIDENCE LEDGER</span><h3>证据账本</h3></div><small>${d.evidenceLedger.length} entries</small></header><div class="ppl-evidence-table"><div class="head"><span>Evidence</span><span>Stance</span><span>Weight</span><span>Source group</span><span>Provenance</span></div>${d.evidenceLedger.map(e=>`<div><b>${esc(e.evidenceId)}</b><span class="stance ${esc(e.stance)}">${esc(e.stance)}</span><span>${esc(fmt(e.quality?.weight))}</span><code>${esc(e.quality?.group)}</code><span>${e.provenanceComplete ? '✓' : '!'}</span></div>`).join('') || '<div class="ppl-empty">尚无 evidence。</div>'}</div></section>`
  }
  return `<section class="ppl-zero-state"><strong>◇</strong><h3>该 Profile 暂无专用领域面板</h3><p>Character/Life 继续使用总览、状态、规则与证据页面。</p></section>`
}


function lifecycleTab(session) {
  const overview = lifecycleOverview(session)
  const turns = lifecycleTurnTimeline(session)
  const tools = lifecycleToolSummary(session)
  const restarts = lifecycleRestartTimeline(session)
  if (!overview.turns && !overview.toolExecutions && !overview.restartMarkers) return `<section class="ppl-zero-state"><strong>↻</strong><h3>该 Session 没有 Host lifecycle audit</h3><p>旧版 app-session 仍可正常查看 Snapshot；只有 ppl.app-session/0.4 才会携带 Agent/Judge/tool/restart sidecar。</p></section>`
  return `
    <section class="ppl-kpi-grid">
      <article><span>Agent Turns</span><strong>${overview.turns}</strong><small>${overview.delivered} deliver · ${overview.blocked} blocked/review</small></article>
      <article><span>Tool Executions</span><strong>${overview.toolExecutions}</strong><small>${overview.replayedTools} replayed</small></article>
      <article><span>Restart Markers</span><strong>${overview.restartMarkers}</strong><small>${overview.processCount} processes</small></article>
      <article><span>Turn Checkpoints</span><strong>${overview.recoverableCheckpoints}</strong><small>durable lifecycle records</small></article>
    </section>
    <section class="ppl-panel"><header><div><span class="ppl-eyebrow">AGENT / JUDGE TIMELINE</span><h3>Agent 生命周期</h3></div><small>${turns.length} turns</small></header><div class="ppl-rule-table ppl-lifecycle-table"><div class="head"><span>Turn</span><span>Status</span><span>Action</span><span>Reason</span><span>Tools</span></div>${turns.map(r=>`<div><b>T${esc(r.turn)}</b><span class="${r.status==='delivered'?'ok':'danger'}">${esc(r.status)}</span><code>${esc(r.actionKind||'—')}</code><span>${esc(r.reason||'—')}</span><span>${esc(r.toolCount)}</span></div>`).join('') || '<div class="ppl-empty">暂无 turn audit。</div>'}</div></section>
    <section class="ppl-two-col"><article class="ppl-panel"><header><div><span class="ppl-eyebrow">TOOL LEDGER</span><h3>工具执行</h3></div><small>${tools.total}</small></header><div class="ppl-domain-list">${tools.rows.map(r=>`<div><div><b>${esc(r.name)}</b><small>${esc(r.callId||'—')}</small></div><div><span>${r.replayed?'replayed':'executed'}</span></div></div>`).join('') || '<div class="ppl-empty">暂无 tool execution。</div>'}</div></article><article class="ppl-panel"><header><div><span class="ppl-eyebrow">RESTART / PROCESS</span><h3>重启轨迹</h3></div><small>${restarts.length}</small></header><div class="ppl-domain-list">${restarts.map(r=>`<div><div><b>${esc(r.event)}</b><small>${esc(r.segmentId||'—')}</small></div><div><span>PID ${esc(r.pid??'—')}</span></div></div>`).join('') || '<div class="ppl-empty">暂无 restart marker。</div>'}</div></article></section>`
}

function diagnosticsTab(session) {
  const rows = sessionDiagnostics(session)
  return `<section class="ppl-panel"><header><div><span class="ppl-eyebrow">DIAGNOSTICS</span><h3>Session 诊断</h3></div><span class="ppl-diagnostic-count ${rows.length ? 'warn' : 'ok'}">${rows.length}</span></header>${rows.length ? `<div class="ppl-diagnostics">${rows.map(d=>`<article class="${esc(d.severity || 'info')}"><div><b>${severityText(d.severity)}</b><code>${esc(d.code || 'DIAGNOSTIC')}</code></div><p>${esc(d.message || (d.details ? JSON.stringify(d.details) : ''))}</p><small>${d.turn ? `Turn ${d.turn}${d.step ? ` · Step ${d.step}` : ''}` : ''}${d.entity ? ` · ${esc(d.entity)}` : ''}</small></article>`).join('')}</div>` : '<div class="ppl-zero-state"><strong>✓</strong><h3>未发现 Session 级异常</h3><p>没有 resolution invalid、rollback diagnostic 或 fingerprint change。</p></div>'}</section>`
}

function evidenceTab(session, entry) {
  const bundle = makeEvidenceBundle(session)
  return `<section class="ppl-two-col evidence"><article class="ppl-panel"><header><div><span class="ppl-eyebrow">EVIDENCE BUNDLE</span><h3>可移植证据包</h3></div><button class="ppl-primary" data-action="download-evidence">导出 JSON</button></header><div class="ppl-summary-list"><div><span>Schema</span><code>${esc(bundle.schema)}</code></div><div><span>Integrity</span><code>${esc(bundle.integrity.value)}</code></div><div><span>Snapshots</span><b>${bundle.overview.snapshots}</b></div><div><span>Rules</span><b>${bundle.overview.uniqueRules}</b></div></div><p class="ppl-help">证据包包含 Session、规则统计、诊断与跨 Turn 因果链；不会重新运行历史 Event Classification 或 PPL Resolution。</p></article><article class="ppl-panel"><header><div><span class="ppl-eyebrow">RAW SNAPSHOT</span><h3>当前原始持久化证据</h3></div><button data-action="copy-raw">复制</button></header><pre class="ppl-raw">${esc(JSON.stringify(entry, null, 2))}</pre></article></section>`
}

export function createObservatory(root, options = {}) {
  const state = { session: null, selected: 0, query: '', filter: 'all', tab: 'overview' }
  root.classList.add('ppl-observatory-root')

  function shell() {
    root.innerHTML = `<div class="ppl-app"><aside class="ppl-sidebar"><div class="ppl-side-brand"><span>P</span><div><b>PPL Observatory</b><small>Program Observatory</small></div></div><div class="ppl-side-title"><span class="ppl-eyebrow">SESSION</span><h2 data-role="session-title">PPL Session</h2></div><label class="ppl-search"><span>⌕</span><input data-role="search" placeholder="搜索 Event / Rule / Path" /></label><select data-role="filter"><option value="all">全部状态</option><option value="applied">已提交</option><option value="discarded">已回滚</option><option value="pending">待提交</option></select><div class="ppl-timeline" data-role="timeline"></div></aside><main class="ppl-workspace"><header class="ppl-topbar"><div><span class="ppl-eyebrow">PPL APPLICATION</span><strong data-role="entity-title">—</strong><small data-role="entity-sub">—</small></div><div class="ppl-top-actions"><button data-action="prev">← 上一个</button><span data-role="position">0 / 0</span><button data-action="next">下一个 →</button><button data-action="theme">◐</button></div></header><nav class="ppl-tabs"><button data-tab="overview" class="active">总览</button><button data-tab="snapshot">当前状态</button><button data-tab="rules">规则与因果</button><button data-tab="domain">领域模型</button><button data-tab="lifecycle">Agent 生命周期</button><button data-tab="diagnostics">诊断</button><button data-tab="evidence">证据</button></nav><div class="ppl-content" data-role="content"></div></main></div>`
    root.querySelector('[data-role="search"]').addEventListener('input', event => { state.query = event.target.value; renderTimeline() })
    root.querySelector('[data-role="filter"]').addEventListener('change', event => { state.filter = event.target.value; renderTimeline() })
    root.querySelector('[data-action="prev"]').addEventListener('click', () => { if (state.selected > 0) { state.selected -= 1; render() } })
    root.querySelector('[data-action="next"]').addEventListener('click', () => { if (state.selected < (state.session?.entries.length || 1) - 1) { state.selected += 1; render() } })
    root.querySelector('[data-action="theme"]').addEventListener('click', () => document.documentElement.classList.toggle('ppl-light'))
    root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; renderMain() }))
  }

  function renderTimeline() {
    const timeline = root.querySelector('[data-role="timeline"]')
    if (!timeline) return
    const entries = state.session?.entries || []
    const q = state.query.toLowerCase().trim()
    const visible = entries.map((entry, index) => ({ entry, index, status: mutationStatus(entry) }))
      .filter(row => state.filter === 'all' || row.status === state.filter)
      .filter(row => !q || stableSearchText(row.entry).includes(q))
    timeline.innerHTML = visible.map(({entry,index,status}) => `<button class="ppl-timeline-item ${index === state.selected ? 'selected' : ''}" data-index="${index}"><div class="ppl-time-head"><strong>T${entry.snapshot.host.turn} · S${entry.snapshot.host.step}</strong><span class="ppl-dot ${status}"></span></div><div class="ppl-time-event">${esc(eventLabel(entry))}</div><div class="ppl-time-foot"><span>${statusText(status)}</span><span>${activeRules(entry).length} rules</span></div></button>`).join('') || '<div class="ppl-empty">没有符合条件的 Snapshot。</div>'
    timeline.querySelectorAll('[data-index]').forEach(button => button.addEventListener('click', () => { state.selected = Number(button.dataset.index); render() }))
  }

  function stableSearchText(entry) {
    const parts = [eventLabel(entry), entityMeta(entry).id, ...activeRules(entry).map(r=>r.id), ...flatten(stateRootSafe(entry)).keys()]
    return parts.join(' ').toLowerCase()
  }

  function stateRootSafe(entry) {
    return ['ppl.profile-snapshot/0.1','ppl.profile-snapshot/0.2'].includes(entry?.snapshot?.schema) ? entry.snapshot.resolution?.resolvedState || {} : entry.snapshot?.resolution?.resolved || {}
  }

  function renderMain() {
    const content = root.querySelector('[data-role="content"]')
    const session = state.session
    const entry = session?.entries?.[state.selected]
    root.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === state.tab))
    if (!entry) { content.innerHTML = '<div class="ppl-zero-state"><strong>P</strong><h3>加载一个 PPL Session</h3><p>支持 Persona Runtime Snapshot 与 PPL Profile Snapshot。</p></div>'; return }
    const meta = entityMeta(entry)
    root.querySelector('[data-role="entity-title"]').textContent = meta.title
    root.querySelector('[data-role="entity-sub"]').textContent = `Turn ${entry.snapshot.host.turn} · Step ${entry.snapshot.host.step} · ${eventLabel(entry)}`
    root.querySelector('[data-role="position"]').textContent = `${state.selected + 1} / ${session.entries.length}`
    if (state.tab === 'overview') content.innerHTML = overviewTab(session, entry, state.selected)
    if (state.tab === 'snapshot') content.innerHTML = snapshotTab(session, entry, state.selected)
    if (state.tab === 'rules') content.innerHTML = rulesTab(session, entry)
    if (state.tab === 'domain') content.innerHTML = domainTab(session, entry)
    if (state.tab === 'lifecycle') content.innerHTML = lifecycleTab(session)
    if (state.tab === 'diagnostics') content.innerHTML = diagnosticsTab(session)
    if (state.tab === 'evidence') content.innerHTML = evidenceTab(session, entry)
    wireContentActions(content)
  }

  function wireContentActions(content) {
    content.querySelector('[data-action="download-evidence"]')?.addEventListener('click', () => {
      const bundle = makeEvidenceBundle(state.session)
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'ppl-evidence-bundle.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    })
    content.querySelector('[data-action="copy-raw"]')?.addEventListener('click', async () => {
      const entry = state.session.entries[state.selected]
      await navigator.clipboard?.writeText(JSON.stringify(entry, null, 2))
    })
  }

  function render() { renderTimeline(); renderMain() }

  function setSession(rawSession) {
    const errors = validateSession(rawSession)
    if (errors.length) throw new Error(errors.join('\n'))
    state.session = normalizeSession(rawSession)
    state.selected = Math.max(0, state.session.entries.length - 1)
    state.query = ''
    state.filter = 'all'
    root.querySelector('[data-role="search"]').value = ''
    root.querySelector('[data-role="filter"]').value = 'all'
    root.querySelector('[data-role="session-title"]').textContent = state.session.title || state.session.profile?.title || 'PPL Session'
    render()
  }

  shell()
  if (options.session) setSession(options.session)
  else render()
  return { setSession, getSession: () => clone(state.session), getSelectedIndex: () => state.selected, render }
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }
