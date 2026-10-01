import fs from 'node:fs'
import { sendJson } from '@ppl/platform-core'
import { ObservatoryReadModel } from './read-model.mjs'

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/observatory', ['index.html', 'text/html; charset=utf-8']],
  ['/observatory/', ['index.html', 'text/html; charset=utf-8']],
  ['/observatory/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/observatory/ui-model.mjs', ['ui-model.mjs', 'text/javascript; charset=utf-8']],
  ['/observatory/style.css', ['style.css', 'text/css; charset=utf-8']],
])
// Only explicit assets are served. Never join a user supplied pathname to the filesystem.
export function serveObservatoryAsset(req, res, pathname) {
  const entry = assets.get(pathname)
  if (!entry || !['GET', 'HEAD'].includes(req.method)) return false
  const body = fs.readFileSync(new URL(`../public/${entry[0]}`, import.meta.url))
  res.writeHead(200, { 'content-type': entry[1], 'content-length': body.length, 'cache-control': 'no-store' })
  res.end(req.method === 'HEAD' ? undefined : body)
  return true
}
export function routeObservatory(req, res, parts, runtime) {
  if (parts[0] !== 'v1' || parts[1] !== 'observatory') return false
  if (req.method !== 'GET') { sendJson(res, 405, { error: 'Observatory projection is read-only', code: 'METHOD_NOT_ALLOWED' }); return true }
  const view = new ObservatoryReadModel(runtime)
  const params = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams)
  let result
  if (parts.length === 3 && parts[2] === 'status') result = view.status()
  else if (parts.length === 3 && parts[2] === 'sessions') result = view.sessions(params)
  else if (parts[2] === 'apps' && parts[4] === 'sessions' && parts[3] && parts[5]) {
    const app = parts[3], sessionId = parts[5]
    if (parts.length === 6) result = view.detail(app, sessionId)
    else if (parts.length === 7 && parts[6] === 'audit') result = view.audit(app, sessionId, params)
    else if (parts.length === 7 && parts[6] === 'executions') result = view.executions(app, sessionId, params)
    else if (parts.length === 8 && parts[6] === 'executions') result = view.execution(app, sessionId, parts[7])
    else if (parts.length === 7 && parts[6] === 'export') {
      result = view.export(app, sessionId)
      res.setHeader('content-disposition', `attachment; filename="ppl-${app}-session.json"`)
    }
  }
  sendJson(res, result === undefined ? 404 : 200, result === undefined ? { error: 'not-found' } : result)
  return true
}
