import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] || path.join(root, 'dist'))
const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'ppl-llm-host-pack-'))
await fs.cp(root, stage, { recursive: true, filter: src => !src.includes(`${path.sep}node_modules${path.sep}`) && !src.includes(`${path.sep}dist${path.sep}`) })
const pkgPath = path.join(stage, 'package.json')
const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
const bundled = ['@ppl/profile-core','@ppl/profile-runtime','@ppl/profile-tutor','@ppl/profile-research']
pkg.dependencies = Object.fromEntries(bundled.map(name => [name, '0.2.0']))
pkg.bundledDependencies = bundled
await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
const tarballs = [
  'ppl-profile-core-0.2.0.tgz', 'ppl-profile-runtime-0.2.0.tgz',
  'ppl-profile-tutor-0.2.0.tgz', 'ppl-profile-research-0.2.0.tgz',
].map(name => path.join(stage, 'vendor', 'npm', name))
function run(args) {
  const r = spawnSync('npm', args, { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status || 1)
}
run(['install','--offline','--ignore-scripts','--no-save', ...tarballs])
const packed = spawnSync('npm', ['pack','--silent'], { cwd: stage, encoding: 'utf8', shell: process.platform === 'win32' })
if (packed.status !== 0) { process.stderr.write(packed.stderr || ''); process.exit(packed.status || 1) }
const name = packed.stdout.trim().split(/\r?\n/).at(-1)
await fs.mkdir(out, { recursive: true })
const target = path.join(out, `ppl-llm-host-adapter-${pkg.version}.tgz`)
await fs.copyFile(path.join(stage, name), target)
console.log(target)
