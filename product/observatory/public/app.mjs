import { APP_NAMES, APP_NOTES, statusInfo, safeExternalUrl, parseRoute, routeHash, defaultAgentInput } from './ui-model.mjs'

const $ = selector => document.querySelector(selector)
const route = parseRoute(location.hash)
const state = { ...route, status: null, sessions: [], offset: 0, total: 0, hasMore: false, q: '', detail: null, runId: null, runOffset: 0, auditOffset: 0, auditType: '', listEpoch: 0, detailEpoch: 0, tabEpoch: 0, busy: false }
const createDialog = $('#create-dialog')
const LIMIT = 15
const tabLabels = { overview:'概览', evidence:'证据', handoffs:'交接与门禁', executions:'执行记录', audit:'审计时间线', actions:'应用操作' }

// All user/provider content is inserted as text, never HTML or an inline handler.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = String(value ?? '')
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value))
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  return node
}
const text = (tag, value, cls) => el(tag, {text:value, ...(cls ? {class:cls} : {})})
const badge = status => { const b = statusInfo(status); return el('span', {class:`badge ${b.tone}`, title:b.raw, text:b.label}) }
const pretty = value => text('pre', JSON.stringify(value, null, 2))
const disclosure = (title, value) => el('details', {class:'disclosure'}, text('summary', title), pretty(value))
const empty = (title, description) => el('div', {class:'empty'}, text('strong', title), text('p', description))
const hint = (value, warning=false) => text('div', value, `hint${warning ? ' warn' : ''}`)
const card = (title, ...children) => el('section', {class:'card'}, text('h3', title), ...children)
const stat = (label, value) => el('div', {class:'stat-line'}, text('span', label, 'muted'), text('strong', value ?? '—'))
const fmtTime = value => value ? new Date(value).toLocaleString('zh-CN', {hour12:false}) : '—'
const publicPath = () => `/v1/observatory/apps/${encodeURIComponent(state.app)}/sessions/${encodeURIComponent(state.sessionId)}`
const commandPath = (app, id) => `/v1/${encodeURIComponent(app)}/sessions/${encodeURIComponent(id)}`
const id = prefix => `${prefix}_${crypto.randomUUID()}`
function notify(message, error = false) {
  $('#notice').hidden = false; $('#notice').textContent = message; $('#notice').className = `notice${error ? ' error' : ''}`
}
function clearNotice() { $('#notice').hidden = true }
async function api(path, options = {}) {
  const response = await fetch(path, { cache:'no-store', ...options, headers:{ ...(options.body ? {'content-type':'application/json'} : {}), ...(options.headers || {}) } })
  const body = await response.json()
  if (!response.ok) throw new Error(`${body.code ? `${body.code}: ` : ''}${body.error || `HTTP ${response.status}`}`)
  return body
}
function saveRoute() { history.replaceState(null, '', routeHash(state.app, state.sessionId, state.tab)) }
function renderNavigation() {
  $('#workspace-title').textContent = APP_NAMES[state.app]
  $('#apps').replaceChildren(...Object.entries(APP_NAMES).map(([app,name], index) => el('button', {type:'button',class:`nav-button${state.app === app ? ' active' : ''}`,'data-app':app, ...(state.app===app ? {'aria-current':'page'} : {}), onclick:()=>switchApp(app)}, text('span', `0${index + 1}`), el('span', {}, name, text('small', app.toUpperCase())))))
}
async function switchApp(app) {
  if (state.busy) return notify('当前操作尚未返回；请保留此页面，避免重复提交。')
  state.app = app; state.sessionId = null; state.tab = 'overview'; state.q = ''; state.offset = 0; state.detail = null; state.detailEpoch++; state.tabEpoch++; $('#search').value = ''; clearNotice(); renderNavigation(); saveRoute(); await loadSessions(true)
}
async function loadStatus() {
  state.status = await api('/v1/observatory/status')
  $('#connect-state').textContent = '本地服务已连接'; $('#connect-state').className = 'badge good'
  const demo = state.status.mode === 'fixture'
  $('#mode-banner').hidden = !demo
  $('#mode-banner').textContent = '演示模式 / FIXTURE：模型、检索资料与 Judge 均为本地测试替身。只用于观察治理行为，不代表真实模型能力或真实研究结论。'
}
async function loadSessions(selectFirst = false) {
  const epoch = ++state.listEpoch
  const params = new URLSearchParams({app:state.app, limit:LIMIT, offset:state.offset, q:state.q})
  try {
    const data = await api(`/v1/observatory/sessions?${params}`)
    if (epoch !== state.listEpoch) return
    state.sessions = data.items; state.total = data.total; state.hasMore = data.hasMore
    if (selectFirst || !state.sessionId) state.sessionId = data.items[0]?.sessionId || null
    renderSessionList(); saveRoute(); await loadDetail()
  } catch(error) { if (epoch === state.listEpoch) notify(`读取会话失败：${error.message}`, true) }
}
function renderSessionList() {
  $('#session-total').textContent = state.total
  $('#sessions-prev').disabled = state.offset === 0
  $('#sessions-next').disabled = !state.hasMore
  $('#sessions-page').textContent = state.total ? `${state.offset + 1}–${Math.min(state.offset+LIMIT,state.total)} / ${state.total}` : '0'
  $('#session-list').replaceChildren(...(state.sessions.length ? state.sessions.map(s => el('button', {type:'button',class:`session-button${state.sessionId === s.sessionId ? ' active' : ''}`,'data-session':s.sessionId,onclick:()=>selectSession(s.sessionId)}, text('span', s.title, 'session-label'), text('small', s.sessionId), badge(s.displayStatus))) : [empty('还没有会话', '新建一个会话，或使用演示启动入口查看治理案例。')]))
}
async function selectSession(sessionId) {
  if (state.busy) return notify('操作执行中，暂不切换会话。')
  state.sessionId = sessionId; state.auditOffset=0; state.runOffset=0; state.runId=null; clearNotice(); renderSessionList(); saveRoute(); await loadDetail()
}
async function loadDetail() {
  const epoch = ++state.detailEpoch; ++state.tabEpoch
  if (!state.sessionId) {
    state.detail = null; $('#session-heading').replaceChildren(); $('#metrics').replaceChildren(); $('#tabs').replaceChildren()
    $('#content').replaceChildren(empty('把治理过程看清楚', APP_NOTES[state.app]), card('开始使用', text('p','点击右上角“新建会话”创建当前应用的独立工作区。'), hint('未配置外部模型时，仍可使用 Tutor、Life、Character 的确定性操作以及读取已有执行记录。'))); return
  }
  try {
    const detail = await api(publicPath())
    if (epoch !== state.detailEpoch) return
    state.detail = detail
    renderHeading(); renderTabs(); await renderTab()
  } catch(error) {
    if (epoch !== state.detailEpoch) return
    state.detail = null; $('#session-heading').replaceChildren(); $('#metrics').replaceChildren(); $('#tabs').replaceChildren()
    $('#content').replaceChildren(empty('无法读取该会话', error.message)); notify(error.message, true)
  }
}
function renderHeading() {
  const d = state.detail
  $('#session-heading').replaceChildren(el('div',{class:'session-head'},el('div',{},text('span',state.app.toUpperCase(),'eyebrow'),text('h2',d.title),el('div',{class:'tag-row'},badge(d.displayStatus),text('span',`Session: ${d.session.status || 'active'}`,'badge neutral')),text('div',`${d.session.sessionId} · ${fmtTime(d.execution.latest?.updatedAt || d.session.updatedAt)}`,'meta')),el('button',{type:'button',class:'secondary',id:'export',onclick:exportSession},'导出诊断 JSON')))
  const metrics = [['治理证据', d.counts.claims],['Agent 交接', d.counts.handoffs],['执行记录', d.counts.executions],['审计事件', d.counts.audit]]
  if (!['research','agent'].includes(state.app)) metrics.splice(0,2,['状态快照', d.session.snapshots?.length || 0],['已处理操作', Object.keys(d.session.processedEvents || d.session.processedOps || {}).length])
  $('#metrics').replaceChildren(...metrics.map(([label,n])=>el('div',{class:'metric'},text('strong',n),text('span',label))))
}
function renderTabs() {
  const tabs = ['research','agent'].includes(state.app) ? Object.keys(tabLabels) : ['overview','audit','actions']
  if (!tabs.includes(state.tab)) state.tab = 'overview'
  $('#tabs').replaceChildren(...tabs.map(tab => el('button',{type:'button',role:'tab',id:`tab-${tab}`,class:`tab${state.tab===tab?' active':''}`,'aria-selected':state.tab===tab,'aria-controls':'content','data-tab':tab,onclick:async()=>{state.tab=tab;state.runId=null;saveRoute();renderTabs();await renderTab()}},tabLabels[tab])))
  $('#content').setAttribute('aria-labelledby', `tab-${state.tab}`)
}
async function renderTab() {
  if (!state.detail) return
  const epoch=++state.tabEpoch
  const out=$('#content'); out.replaceChildren()
  if (state.tab==='overview') return renderOverview(out)
  if (state.tab==='evidence') return renderEvidence(out)
  if (state.tab==='handoffs') return renderHandoffs(out)
  if (state.tab==='actions') return renderActions(out)
  out.replaceChildren(text('p','正在读取记录…','muted'))
  try {
    if (state.tab==='executions') {
      const data=await api(`${publicPath()}/executions?limit=15&offset=${state.runOffset}`)
      if(epoch!==state.tabEpoch)return
      out.replaceChildren(hint('执行记录读取不依赖模型在线。配置模型只决定能否新建执行，不代表已通过真实模型资格验收。'))
      if(!data.items.length){out.append(empty('没有执行记录','到“应用操作”发起任务；未配置执行服务时，该入口会显示禁用原因。'));return}
      const list=el('div',{class:'run-list'}), detail=el('div',{id:'run-detail'})
      state.runId=data.items.some(r=>r.runId===state.runId)?state.runId:data.items[0].runId
      const buttons=[]
      for(const run of data.items){const b=el('button',{type:'button',class:`run-button${run.runId===state.runId?' active':''}`,'data-run':run.runId,onclick:async()=>{state.runId=run.runId;buttons.forEach(x=>x.classList.toggle('active',x.dataset.run===run.runId));await loadRun(detail,run.runId,epoch)}},el('span',{},run.runId,text('small',fmtTime(run.updatedAt))),badge(run.status));buttons.push(b);list.append(b)}
      out.append(list, pager(data,async offset=>{state.runOffset=offset;await renderTab()}), detail)
      await loadRun(detail,state.runId,epoch)
    } else if (state.tab==='audit') {
      const data=await api(`${publicPath()}/audit?limit=25&offset=${state.auditOffset}&type=${encodeURIComponent(state.auditType)}`)
      if(epoch!==state.tabEpoch)return
      out.replaceChildren()
      const filter=el('input',{type:'search',value:state.auditType,placeholder:'按事件类型筛选','aria-label':'事件类型筛选'})
      out.append(el('form',{class:'toolbar',onsubmit:async e=>{e.preventDefault();state.auditType=filter.value.trim();state.auditOffset=0;await renderTab()}},filter,el('button',{type:'submit',class:'secondary'},'筛选事件'),text('span',`${data.total} 条记录`,'muted')))
      if(!data.items.length)out.append(empty('暂无匹配的审计事件','变更由业务服务记录；页面不会伪造补齐事件。'))
      for(const e of data.items)out.append(el('div',{class:'timeline-item'},text('span',String(e.seq).padStart(2,'0'),'seq'),el('section',{class:'card'},text('h3',e.type),text('time',fmtTime(e.at)),disclosure('事件内容',e.data ?? e.payload ?? e))))
      out.append(pager(data,async offset=>{state.auditOffset=offset;await renderTab()}))
    }
  } catch(error){if(epoch===state.tabEpoch){out.replaceChildren(empty('记录读取失败',error.message));notify(error.message,true)}}
}
function pager(data, action) {
  const before=el('button',{type:'button',class:'quiet',onclick:()=>action(Math.max(0,data.offset-data.limit))},'上一页');before.disabled=!data.offset
  const after=el('button',{type:'button',class:'quiet',onclick:()=>action(data.offset+data.limit)},'下一页');after.disabled=!data.hasMore
  return el('div',{class:'pagination'},before,text('span',`共 ${data.total} 条 · 偏移 ${data.offset}`),after)
}
function renderOverview(out) {
  const d=state.detail, s=d.session
  out.append(hint(APP_NOTES[state.app]))
  if(d.execution?.latest)out.append(hint('执行状态表示最近一次运行的结果；后续手工修改 Session 不会重新验证历史交付。'))
  if(state.app==='research'){
    out.append(el('div',{class:'grid-two'},card('证据立场',stat('支持',d.domain.supportCount),stat('反对',d.domain.opposeCount),stat('其他 / 中立',d.domain.claimCount-d.domain.supportCount-d.domain.opposeCount)),card('执行与交付',stat('执行服务',d.execution.configured?'已配置（不等于已验收）':'未配置'),stat('最近执行',statusInfo(d.displayStatus).label),stat('交付候选数',d.domain.deliveryCount))))
    if(!s.deliveries.length)out.append(card('尚无最终交付',text('p', d.displayStatus.includes('blocked') ? '当前流程已被阻断。查看“交接与门禁”或“执行记录”定位失败阶段。' : '添加证据或发起研究执行后，交付候选需要经过独立语义 Judge。')))
    for(const delivery of [...s.deliveries].reverse())out.append(renderDelivery(delivery))
  }else if(state.app==='agent'){
    for(const c of s.agentContracts)out.append(card(`${c.agentId} · ${c.role}`,stat('权限域',(c.authorityScopes||[]).join(', ')),stat('可委派目标',(c.delegation?.allowedTargets||[]).join(', ')||'无'),stat('允许工具',(c.tools||[]).join(', ')||'无'),disclosure('完整 Agent contract',c)))
  }else if(state.app==='tutor'){
    const summary=d.domain.summary, model=summary.model||{}, policy=summary.policy||{}, verifier=summary.verifier||{}
    out.append(hint('掌握度 / 不确定性是当前模型的状态输出，不是已验证的学习效果指标。',true),el('div',{class:'grid-two'},card('学习证据',stat('当前技能',summary.currentSkillId),stat('掌握度均值',model.mean),stat('不确定性',model.uncertainty),stat('独立测评次数',model.directAssessments),stat('辅助测评次数',model.assistedAssessments)),card('教学策略与验证',stat('策略模式',policy.mode),stat('提示级别',policy.hintLevel),stat('已验证干预',verifier.verified),stat('进展 / 无变化 / 退步',`${verifier.progress||0} / ${verifier.neutral||0} / ${verifier.regress||0}`))),disclosure('完整学习摘要',summary),disclosure('完整学习状态',s.state))
  }else if(state.app==='life'){
    out.append(el('div',{class:'grid-two'},card('长期偏好',stat('偏好安静场所',s.state.preferences?.quietPlaces?'是':'否'),stat('偏好早晨规划',s.state.preferences?.morningPlanning?'是':'否')),card('长期计划',stat('当前计划',s.state.plan?.current||'尚未设置'),stat('计划状态',s.state.plan?.status||'—'))),hint('实时观察只保留定位符与审计元数据；事实值不会变成长记忆。定位符本身仍可能包含敏感信息。'),card('服务状态与风险边界',pretty(s.state.service||{})),disclosure('完整个人助手状态',s.state))
  }else{
    out.append(card('角色关系',stat('关系阶段',s.state.relationship?.stage),stat('信任值',s.state.relationship?.trust),stat('私下模式',s.state.interaction?.privateMode?'是':'否')),disclosure('最近状态快照',s.snapshots.at(-1)||{}))
  }
  out.append(disclosure('脱敏后的会话快照（仍可能含业务数据）',s))
}
function renderDelivery(delivery){
  const section=el('section',{class:`card ${delivery.status==='delivered'?'good-border':'bad-border'}`},el('div',{class:'card-title'},text('h3','交付候选'),badge(delivery.status)),text('div',delivery.deliveryId,'source-id'))
  if(delivery.status==='delivered'&&delivery.rendered?.renderedText)section.append(text('pre',delivery.rendered.renderedText,'report'))
  else section.append(hint('该候选未通过交付边界，不作为最终回答展示。',true))
  section.append(disclosure('证据绑定',delivery.binding||{}),disclosure('Judge 原始判定',delivery.judgeResult||{status:'not-run'}),disclosure('门禁评估',delivery.assessment||delivery.structuralReport||{}))
  return section
}
function renderEvidence(out){
  const claims=state.detail.session.context?.claims||[]
  out.append(hint('以下是账本中的规范化主张。它们可以是 provisional；置信度与来源引用不构成事实真实性保证。'))
  if(!claims.length){out.append(empty('暂无规范化主张','Research 可手动录入主张或通过检索提取；Agent 使用自己的 Context claims。'));return}
  for(const c of claims){
    const b=text('span',({support:'支持',oppose:'反对',neutral:'中立'})[c.polarity]||c.polarity,`badge ${c.polarity==='oppose'?'warn':'neutral'}`)
    const section=el('section',{class:'card','data-claim':c.claimId},el('div',{class:'tag-row'},b,badge(c.status),c.requiredForDecision?text('span','决策必需','badge neutral'):null),text('p',c.canonicalText,'evidence-text'),text('div',c.claimId,'source-id'),stat('记录置信度',Number.isFinite(c.confidence)?c.confidence.toFixed(2):'—'),stat('冲突集合',c.conflictSetId||'无'),stat('主张提供方',c.assertedBy))
    const sources=el('div',{class:'sources'})
    for(const ref of c.sourceRefs||[]){const safe=safeExternalUrl(ref);sources.append(safe?el('a',{href:safe,target:'_blank',rel:'noopener noreferrer'},ref):text('span',ref,'source-id'))}
    section.append(sources,disclosure('完整规范化主张',c));out.append(section)
  }
}
function renderFindings(report){
  const box=el('div')
  if(report.hardGatePassed===true)box.append(text('div','结构保真门禁通过；语义真实性不由此项保证。','finding good'))
  const explanations={
    REQUIRED_CLAIM_OMISSION:'接收方遗漏了决策必需的主张，交接被阻断。',
    COUNTER_EVIDENCE_ERASURE:'接收方删除了冲突集合中的反对证据，不能继续交付。',
    CONFIDENCE_INFLATION:'接收方在没有授权证据的情况下提高了置信度。',
    POLARITY_FLIP:'接收方改变了原始主张的支持 / 反对立场。',
    PROVENANCE_LOSS:'接收方遗漏了原始主张的来源或溯源信息。',
    STATUS_ESCALATION:'主张状态被未经授权地提升。'
  }
  for(const f of report.findings||[]){
    const message=f.message||explanations[f.code]||(typeof f.reason==='string'?f.reason:'门禁发现不一致，请查看原始检测记录。')
    box.append(el('div',{class:'finding'},text('strong',f.code||'FINDING'),text('span',message),f.claimId?text('div',f.claimId,'source-id'):null,disclosure('检测详情',f)))
  }
  return box
}
function renderHandoffs(out){
  const s=state.detail.session
  if(!(s.handoffs||[]).length)out.append(empty('尚无成功建立的交接','委派被拒绝时不会产生合法 handoff；拒绝原因仍保留在审计事件中。'))
  for(const h of s.handoffs||[]){const reports=(s.fidelity||[]).filter(r=>r.handoffId===h.handoffId);out.append(el('section',{class:'card'},el('div',{class:'flow-node'},text('b',h.sourceAgentId),text('span','→'),text('b',h.targetAgentId)),text('div',h.handoffId,'source-id'),stat('传递的主张',(h.payload?.claims||[]).length),...reports.map(renderFindings),!reports.length?hint('尚无 receiver fidelity 检查记录。'):null,disclosure('完整交接记录',h)))}
  const blocked=(s.audit||[]).filter(e=>e.type==='handoff.blocked')
  for(const e of blocked)out.append(card('委派 / 投影被拒绝',pretty(e.data)))
}
async function loadRun(out,runId,epoch){
  out.replaceChildren(text('p','读取执行详情…','muted'))
  try{
    const run=await api(`${publicPath()}/executions/${encodeURIComponent(runId)}`)
    if(epoch!==state.tabEpoch||state.runId!==runId)return
    out.replaceChildren(card('执行结果',badge(run.status),stat('运行 ID',run.runId),stat('更新时间',fmtTime(run.updatedAt))))
    if(run.error)out.append(card('失败详情',pretty(run.error)))
    if(run.retrieval)out.append(card('检索资料',stat('Provider',run.retrieval.provider),...(run.retrieval.documents||[]).map(doc=>el('details',{class:'disclosure'},text('summary',doc.title||doc.documentId),text('p',doc.text),text('div',doc.url||doc.documentId,'source-id')))))
    for(const [name,step] of [['Analyst',run.analyst],['Reviewer',run.reviewer]])if(step)out.append(card(`${name} · 保真门禁`,badge(step.fidelity?.hardGatePassed?'completed':'blocked'),renderFindings(step.fidelity||{}),disclosure('阶段记录',step)))
    if(run.fidelity)out.append(card('Receiver fidelity',renderFindings(run.fidelity)))
    if(run.delivery?.finalized)out.append(renderDelivery(run.delivery.finalized))
    else if(run.delivery)out.append(card('交付流程尚未完成',pretty(run.delivery)))
    if(run.toolResults?.length){
      for(const tool of run.toolResults)out.append(card(`工具执行 · ${tool.name||tool.toolName||tool.callId}`,stat('调用 ID',tool.callId),stat('Ledger ID',tool.ledgerCallId),disclosure('Host 工具结果与来源',tool)))
    }else out.append(hint('该运行没有已记录的工具执行结果；这不应被解读为工具链已经通过验收。'))
    out.append(disclosure('完整执行记录（已做凭据脱敏）',run))
  }catch(error){if(epoch===state.tabEpoch&&state.runId===runId)out.replaceChildren(empty('执行详情读取失败',error.message))}
}
function field(formKey,f){
  const domId=`${formKey}-${f.name}`
  const common={id:domId,name:f.name,...(f.required?{required:''}:{}),...(f.min!==undefined?{min:f.min}:{}),...(f.max!==undefined?{max:f.max}:{}),...(f.step?{step:f.step}:{}),...(f.placeholder?{placeholder:f.placeholder}:{})}
  let control
  if(f.type==='textarea')control=el('textarea',common,f.value||'')
  else if(f.type==='select'){control=el('select',common,...f.options.map(o=>el('option',{value:Array.isArray(o)?o[0]:o},Array.isArray(o)?o[1]:o)));if(f.value!==undefined)control.value=f.value}
  else{control=el('input',{...common,type:f.type||'text',...(f.type!=='checkbox'?{value:f.value??''}:{})});if(f.type==='checkbox')control.checked=Boolean(f.value)}
  return el('div',{class:`field${f.type==='checkbox'?' checkbox':''}${f.mono?' mono':''}`},...(f.type==='checkbox'?[control,el('label',{for:domId},f.label)]:[el('label',{for:domId},f.label),control]),f.help?text('span',f.help,'field-help'):null)
}
function mountForm(out,{key,title,fields,description,submitLabel='提交',endpoint,build,enabled=true,disabledReason,onSuccess}){
  const form=el('form',{class:'operation-form','data-form':key})
  if(description)form.append(hint(description))
  fields.forEach(f=>form.append(field(key,f)))
  const button=el('button',{type:'submit'},submitLabel);button.disabled=!enabled
  form.append(el('div',{class:'form-actions'},button,disabledReason&&!enabled?text('span',disabledReason):null))
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(state.busy||!enabled||!form.reportValidity())return
    const values=Object.fromEntries(new FormData(form))
    for(const f of fields)if(f.type==='checkbox')values[f.name]=form.elements.namedItem(f.name).checked
    let body
    try{body=build(values)}catch(error){notify(`输入无效：${error.message}`,true);return}
    state.busy=true;button.disabled=true;form.setAttribute('aria-busy','true');clearNotice()
    try{
      const result=await api(endpoint,{method:'POST',body:JSON.stringify(body)})
      if(onSuccess)await onSuccess(result)
      else{await loadSessions(false);notify(result.duplicate?'该操作已处理，未重复应用。':`操作已记录${result.status?' · '+statusInfo(result.status).label:''}。`)}
    }catch(error){notify(`操作未确认完成：${error.message}。网络中断后请先刷新执行/审计记录，再决定是否重试。`,true)}
    finally{state.busy=false;button.disabled=!enabled;form.removeAttribute('aria-busy')}
  })
  out.append(card(title,form));return form
}
function renderActions(out){
  const app=state.app, s=state.detail.session, base=commandPath(app,s.sessionId)
  out.append(hint('这些操作调用各应用自己的业务 API。观测接口只读；页面不提供伪造 Judge 通过或强行放行的按钮。'))
  if(app==='research'){
    mountForm(out,{key:'research-execute',title:'发起研究执行',description:state.status?.mode==='fixture'?'当前是测试替身执行，将使用固定演示资料，不进行真实检索。':'服务端执行检索、模型与 Judge；浏览器不接收 API Key。',fields:[{name:'limit',label:'检索资料上限',type:'number',min:1,max:10,value:5,required:true}],submitLabel:'执行研究任务',endpoint:base+'/execute',enabled:state.detail.execution.configured,disabledReason:'执行未配置。请在服务端设置 .env 中的模型、Judge 和检索参数后重启。',build:v=>({runId:id('research_run'),limit:Number(v.limit)})})
    mountForm(out,{key:'research-claim',title:'手动录入规范化主张',description:'手动录入一律标记 provisional。先记录来源与立场，不把未经核验的陈述直接标为已证实。',fields:[{name:'canonicalText',label:'主张内容',type:'textarea',required:true},{name:'polarity',label:'相对研究问题的立场',type:'select',options:[['support','支持'],['oppose','反对'],['neutral','中立']]},{name:'sourceRefs',label:'来源引用（每行一个）',type:'textarea',required:true},{name:'confidence',label:'记录置信度 0–1',type:'number',min:0,max:1,step:'0.01',value:.5,required:true},{name:'conflictSetId',label:'冲突集合 ID',placeholder:'同一争议的主张使用同一 ID'},{name:'required',label:'决策必须保留该主张',type:'checkbox',value:true}],endpoint:base+'/claims',build:v=>({canonicalText:v.canonicalText,status:'provisional',polarity:v.polarity,sourceRefs:v.sourceRefs.split('\n').map(x=>x.trim()).filter(Boolean),confidence:Number(v.confidence),conflictSetId:v.conflictSetId||null,requiredForDecision:v.required})})
  }else if(app==='agent'){
    const contracts=s.agentContracts, source=contracts[0], target=contracts[1]
    mountForm(out,{key:'agent-execute',title:'发起受治理的 Agent 交接',description:'这里的权限、能力和工具名称是请求项，仍须通过现有 contract 校验。工具执行还要求宿主已注册 Tool Registry。',fields:[{name:'sourceAgentId',label:'来源 Agent',type:'select',options:contracts.map(c=>c.agentId),value:source.agentId},{name:'targetAgentId',label:'目标 Agent',type:'select',options:contracts.map(c=>c.agentId),value:target.agentId},{name:'capabilities',label:'请求能力（逗号分隔）',value:(target.capabilities||[]).join(',')},{name:'authority',label:'请求权限域（逗号分隔）',value:(source.authorityScopes||[]).join(',')},{name:'tools',label:'请求工具（逗号分隔，可为空）',value:''},{name:'objective',label:'本次交接任务',type:'textarea',value:s.context.state.topic||'保留所有规范化主张并完成任务。',required:true}],submitLabel:'执行 Agent 交接',endpoint:base+'/execute',enabled:state.detail.execution.configured,disabledReason:'Agent 执行服务未配置。',build:v=>{const csv=x=>x.split(',').map(y=>y.trim()).filter(Boolean);return {runId:id('agent_run'),sourceAgentId:v.sourceAgentId,targetAgentId:v.targetAgentId,requestedCapabilities:csv(v.capabilities),requestedAuthorityScopes:csv(v.authority),requestedTools:csv(v.tools),task:{objective:v.objective},transform:{mode:'structured-summary',summary:'Preserve canonical context.'}}}})
  }else if(app==='tutor'){
    mountForm(out,{key:'tutor-observation',title:'记录一次作答证据',fields:[{name:'skillId',label:'技能 ID',value:s.state.learner?.currentSkillId||'fractions.addition',required:true},{name:'correct',label:'本次作答正确',type:'checkbox',value:true},{name:'hintCount',label:'使用提示次数',type:'number',min:0,max:100,value:0,required:true},{name:'attemptCount',label:'作答尝试次数',type:'number',min:1,max:100,value:1,required:true}],endpoint:base+'/observations',build:v=>({eventId:id('observation'),skillId:v.skillId,correct:v.correct,assessment:{hintCount:Number(v.hintCount),attemptCount:Number(v.attemptCount)}})})
    mountForm(out,{key:'tutor-intervention',title:'记录教学干预',fields:[{name:'interventionId',label:'干预 ID',required:true},{name:'strategy',label:'策略',value:'worked-example',required:true},{name:'skillId',label:'技能 ID',value:s.state.learner?.currentSkillId||'fractions.addition',required:true}],endpoint:base+'/interventions',build:v=>({...v,eventId:id('intervention')})})
    mountForm(out,{key:'tutor-verification',title:'验证教学干预',fields:[{name:'interventionId',label:'待验证干预 ID',required:true},{name:'outcome',label:'验证结果',type:'select',options:[['progress','有进展'],['neutral','无明确变化'],['regress','退步']]},{name:'confidence',label:'验证置信度',type:'number',min:0,max:1,step:'0.01',value:.8,required:true}],endpoint:base+'/verifications',build:v=>({...v,confidence:Number(v.confidence),eventId:id('verification')})})
  }else if(app==='life'){
    mountForm(out,{key:'life-preference',title:'显式更新长期偏好',fields:[{name:'key',label:'偏好',type:'select',options:[['quietPlaces','安静的场所'],['morningPlanning','早晨规划']]},{name:'value',label:'偏好值',type:'select',options:[['true','是'],['false','否']]},{name:'consent',label:'确认将该偏好写入长期状态',type:'checkbox',required:true}],endpoint:base+'/preferences',build:v=>({requestId:id('pref'),key:v.key,value:v.value==='true'})})
    mountForm(out,{key:'life-plan',title:'显式更新计划',fields:[{name:'plan',label:'计划内容',type:'textarea',required:true},{name:'consent',label:'确认将该计划写入长期状态',type:'checkbox',required:true}],endpoint:base+'/plans',build:v=>({requestId:id('plan'),plan:v.plan})})
    mountForm(out,{key:'life-realtime',title:'记录实时观察的定位符',description:'仅记录观察位置。当前 API 不把事实值保存到长期记忆。',fields:[{name:'locator',label:'观察定位符',placeholder:'weather:local:now',required:true}],endpoint:base+'/realtime',build:v=>({eventId:id('realtime'),locator:v.locator})})
    mountForm(out,{key:'life-risk',title:'标记高风险边界',fields:[{name:'reason',label:'风险原因',required:true},{name:'authoritativeLayer',label:'需要移交的人工或权威处理层',required:true}],endpoint:base+'/risk',build:v=>({...v,eventId:id('risk')})})
  }else{
    mountForm(out,{key:'character-comfort',title:'COMFORT · 安慰事件',description:'应用 Character 的确定性状态规则，增加信任并进入私下模式。',fields:[],endpoint:base+'/comfort',submitLabel:'提交 COMFORT 事件',build:()=>({eventId:id('comfort')})})
    mountForm(out,{key:'character-confession',title:'CONFESSION · 表白事件',description:'当前兼容示例直接将关系阶段切换为 lover；并非完整的关系或剧情系统。',fields:[],endpoint:base+'/confession',submitLabel:'提交 CONFESSION 事件',build:()=>({eventId:id('confession')})})
  }
}
function openCreate(){
  if(state.busy)return
  const app=state.app, container=$('#create-fields');container.replaceChildren();$('#create-title').textContent=`新建 · ${APP_NAMES[app]}`
  let fields=[{name:'sessionId',label:'会话 ID（可留空自动生成）'}]
  if(app==='research')fields.push({name:'question',label:'研究问题',type:'textarea',required:true,placeholder:'例如：方法 A 的收益是否有充分证据支持？'})
  if(app==='agent')fields.push({name:'definition',label:'Agent contracts 与初始 context（JSON）',type:'textarea',mono:true,required:true,value:JSON.stringify(defaultAgentInput(),null,2)})
  if(app==='tutor')fields.push({name:'learnerId',label:'学习者 ID'},{name:'skillId',label:'技能 ID',value:'fractions.addition',required:true})
  if(app==='life')fields.push({name:'userId',label:'用户标识（本地数据标识，不是登录账户）'})
  if(app==='character')fields.push({name:'characterId',label:'角色 ID'},{name:'userId',label:'交互用户标识'})
  mountForm(container,{key:'create',title:'独立应用会话',description:APP_NOTES[app],fields,submitLabel:'创建会话',endpoint:`/v1/${app}/sessions`,build:v=>{const result=app==='agent'?{...JSON.parse(v.definition),sessionId:v.sessionId||undefined}:Object.fromEntries(Object.entries(v).filter(([,value])=>value!==''));return result},onSuccess:async result=>{createDialog.close();state.sessionId=result.sessionId;state.offset=0;state.q='';$('#search').value='';state.tab='overview';saveRoute();await loadSessions(false);notify('会话已创建。可在“应用操作”继续。')}})
  createDialog.showModal();container.querySelector('input,textarea')?.focus()
}
async function exportSession(){
  const app=state.app
  if(!window.confirm('导出包含会话、来源与执行记录，仍可能含敏感业务数据。凭据脱敏不是完整匿名化。确认导出？'))return
  try{const data=await api(`${publicPath()}/export`);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a',{href:url,download:`ppl-${app}-session.json`});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('诊断 JSON 已生成。分享前请检查其中的业务数据。')}catch(error){notify(`导出失败：${error.message}`,true)}
}
$('#create-open').addEventListener('click',openCreate)
$('#create-close').addEventListener('click',()=>{if(!state.busy)createDialog.close()})
createDialog.addEventListener('cancel',e=>{if(state.busy)e.preventDefault()})
$('#search-form').addEventListener('submit',async e=>{e.preventDefault();if(state.busy)return;state.q=$('#search').value.trim();state.offset=0;await loadSessions(true)})
$('#sessions-prev').addEventListener('click',async()=>{if(state.busy)return;state.offset=Math.max(0,state.offset-LIMIT);await loadSessions(true)})
$('#sessions-next').addEventListener('click',async()=>{if(state.busy)return;state.offset+=LIMIT;await loadSessions(true)})
$('#refresh').addEventListener('click',async()=>{if(state.busy)return notify('已有操作在执行；任务完成后将自动刷新。');try{await loadStatus();await loadSessions(false);notify('已刷新会话与执行记录。')}catch(error){notify(`刷新失败：${error.message}`,true)}})
window.addEventListener('hashchange',async()=>{if(state.busy)return;const next=parseRoute(location.hash);Object.assign(state,next,{offset:0,q:''});$('#search').value='';renderNavigation();await loadSessions(false)})
renderNavigation()
try{await loadStatus();await loadSessions(false)}catch(error){$('#connect-state').textContent='服务未连接';$('#connect-state').className='badge bad';notify(`连接失败：${error.message}`,true);$('#content').replaceChildren(empty('服务不可用','确认 Gateway 正在运行，然后点击刷新。'))}
