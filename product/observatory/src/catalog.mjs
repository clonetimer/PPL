export const OBSERVATORY_VERSION = '1.0.0-dev.5'
export const APP_CATALOG = Object.freeze([
  { id: 'research', name: '研究与证据', subtitle: 'Research', description: '从资料到结论，保留反证、来源与不确定性。', hasExecution: true },
  { id: 'agent', name: 'Agent 治理', subtitle: 'Agent', description: '检查委派权限、上下文投影与交接保真。', hasExecution: true },
  { id: 'tutor', name: '学习状态', subtitle: 'Tutor', description: '区分独立作答与提示后作答，观察学习证据。', hasExecution: false },
  { id: 'life', name: '个人助手', subtitle: 'Life', description: '显式更新偏好与计划，不把实时事实写成长期记忆。', hasExecution: false },
  { id: 'character', name: '角色状态', subtitle: 'Character', description: '通过确定性事件更新关系状态，查看状态快照。', hasExecution: false },
])
export function assertApp(app) {
  if (!APP_CATALOG.some(row => row.id === app)) {
    const error = new Error(`unknown application: ${app}`); error.code = 'NOT_FOUND'; throw error
  }
  return app
}
