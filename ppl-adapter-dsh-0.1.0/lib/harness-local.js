import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function isHarnessRoot(dir) {
  const pkg = resolve(dir, 'package.json')
  if (!existsSync(pkg)) return false
  try {
    const data = JSON.parse(readFileSync(pkg, 'utf8'))
    return data?.name === '@deepseek-ai/dsh-root'
  } catch {
    return false
  }
}

export function findHarnessRoot(start = process.cwd()) {
  const explicit = process.env.PPL_DSH_ROOT
  if (explicit) {
    const root = resolve(explicit)
    if (!isHarnessRoot(root)) {
      throw new Error(`PPL_DSH_ROOT is not a DeepSeek Harness root: ${root}`)
    }
    return root
  }

  let current = resolve(start)
  for (;;) {
    if (isHarnessRoot(current)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  throw new Error(
    `Could not locate DeepSeek Harness root from ${resolve(start)}. `
    + 'Run from the repository root or set PPL_DSH_ROOT.',
  )
}

export function harnessEntry(root, relativePackageDir) {
  const entry = resolve(root, relativePackageDir, 'lib', 'index.js')
  if (!existsSync(entry)) {
    throw new Error(
      `DeepSeek Harness build artifact not found: ${entry}\n`
      + 'Run `pnpm run build:lib:host` from the Harness repository root first.',
    )
  }
  return entry
}

export async function importHarnessEntry(root, relativePackageDir) {
  return import(pathToFileURL(harnessEntry(root, relativePackageDir)).href)
}
