#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const standaloneDir = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.PORT || 4173)
const host = process.env.HOST || '127.0.0.1'
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' }
const moduleFiles = new Map([
  ['/modules/app-core/index.mjs', fileURLToPath(import.meta.resolve('@ppl/app-core'))],
  ['/modules/app-ui/index.mjs', fileURLToPath(import.meta.resolve('@ppl/app-ui'))],
  ['/modules/app-ui/styles.css', fileURLToPath(import.meta.resolve('@ppl/app-ui/styles.css'))],
])

function localPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  if (decoded === '/' || decoded === '') return join(standaloneDir, 'index.html')
  const target = resolve(standaloneDir, decoded.replace(/^\//, ''))
  const rel = relative(standaloneDir, target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path escapes standalone root')
  return target
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    let path = moduleFiles.get(urlPath) || localPath(urlPath)
    const info = await stat(path)
    if (info.isDirectory()) path = join(path, 'index.html')
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(body)
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`Not found: ${error.message}`)
  }
})
server.listen(port, host, () => console.log(`PPL Observatory 0.4.0: http://${host}:${port}`))
