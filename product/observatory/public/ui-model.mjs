export const APP_NAMES = { research: '研究与证据', agent: 'Agent 治理', tutor: '学习状态', life: '个人助手', character: '角色状态' }
export const APP_NOTES = {
  research: '完整链路：检索 → 提取 → 分析 → 复核 → Judge → 交付。门禁通过不等于原始资料真实。',
  agent: '授权决定能否交接，保真检查决定模型返回能否接受。执行前需由宿主注册允许使用的工具。',
  tutor: '这是学习状态与证据引擎，不是完整课程系统。掌握度模型尚未通过真实学习数据校准。',
  life: '只通过显式操作修改长期偏好或计划。实时事实值不写入长期 Profile，但会记录观察定位符。',
  character: '这是确定性关系状态示例，不是完整 NPC 对话产品。COMFORT 与 CONFESSION 使用独立业务规则。',
}
const STATUS_LABELS = { active:'活动中', collecting:'等待证据', 'evidence-ready':'证据已就绪', started:'尚无终态', completed:'执行完成', delivered:'已交付', 'delivery-pending':'等待 Judge', 'pending-semantic-judge':'等待 Judge', 'no-relevant-evidence':'未找到相关证据', failed:'执行失败', 'model-failed':'模型调用失败', 'blocked-analyst-fidelity':'分析交接被阻断', 'blocked-reviewer-fidelity':'复核交接被阻断', 'blocked-by-semantic-judge':'Judge 已拒绝', 'blocked-by-fidelity':'保真检查未通过' }
export function statusInfo(status) {
  const raw = String(status || 'unknown')
  const tone = /blocked|failed|invalid/.test(raw) ? 'bad' : ['completed','delivered'].includes(raw) ? 'good' : /started|pending|no-relevant/.test(raw) ? 'warn' : 'neutral'
  return { raw, label: STATUS_LABELS[raw] || raw, tone }
}
export function safeExternalUrl(value) {
  try { const url = new URL(String(value)); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
export function parseRoute(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''))
  return { app: Object.hasOwn(APP_NAMES, q.get('app')) ? q.get('app') : 'research', sessionId: q.get('session') || null, tab: ['overview','evidence','handoffs','executions','audit','actions'].includes(q.get('tab')) ? q.get('tab') : 'overview' }
}
export function routeHash(app, sessionId, tab) {
  return '#' + new URLSearchParams({ app, ...(sessionId ? { session: sessionId } : {}), tab }).toString()
}
export function defaultAgentInput() {
  const common = { schema:'ppl.multi-agent.agent-contract/0.1', authorityScopes:['work:evidence'], tools:[], contextPolicy:{ allowedSensitivities:['public','task'], allowedStatePaths:['topic'], preserveConflictSets:true } }
  return {
    agentContracts:[
      { ...structuredClone(common), agentId:'source', role:'source', capabilities:['handoff'], delegation:{allowedTargets:['target'],maxDepth:2,transferableAuthorityScopes:['work:evidence'],allowCycles:false,allowSelfDelegation:false} },
      { ...structuredClone(common), agentId:'target', role:'receiver', capabilities:['analyze'], delegation:{allowedTargets:[],maxDepth:2,transferableAuthorityScopes:[],allowCycles:false,allowSelfDelegation:false} },
    ],
    context:{schema:'ppl.multi-agent.context/0.1',state:{topic:'待办任务'},claims:[]},
  }
}
