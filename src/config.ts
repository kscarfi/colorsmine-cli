import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A gate that lives in CI needs its settings in the repo, not in a workflow
 * file nobody reads. This also gives role overrides somewhere permanent to
 * live — a project's naming convention does not change between runs, so
 * re-typing `--role muted=--text-dim` on every invocation would be a tax on
 * exactly the projects the heuristic gets wrong.
 */
export interface Config {
  files?: string[]
  min?: string
  wcag?: boolean
  dark?: boolean
  roles?: Record<string, string>
}

const NAMES = ['colorsmine.json', '.colorsmine.json']

export function loadConfig(cwd: string, explicit?: string): { config: Config; from: string | null } {
  if (explicit) {
    const path = resolve(cwd, explicit)
    if (!existsSync(path)) throw new Error(`${explicit}: no such config file`)
    return { config: parse(readFileSync(path, 'utf8'), explicit), from: explicit }
  }
  for (const name of NAMES) {
    const path = resolve(cwd, name)
    if (existsSync(path)) return { config: parse(readFileSync(path, 'utf8'), name), from: name }
  }
  // A `colorsmine` key in package.json, for projects that keep tool config there.
  const pkgPath = resolve(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg && typeof pkg.colorsmine === 'object') {
        return { config: validate(pkg.colorsmine, 'package.json'), from: 'package.json (colorsmine)' }
      }
    } catch {
      // A broken package.json is not this tool's problem to report.
    }
  }
  return { config: {}, from: null }
}

function parse(text: string, source: string): Config {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`${source}: not valid JSON — ${(e as Error).message}`)
  }
  return validate(data, source)
}

/** Reject what we cannot honour rather than ignoring it silently. */
function validate(data: unknown, source: string): Config {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${source}: expected an object`)
  const o = data as Record<string, unknown>
  const out: Config = {}
  const known = ['files', 'min', 'wcag', 'dark', 'roles']
  for (const key of Object.keys(o)) {
    if (!known.includes(key)) throw new Error(`${source}: unknown option "${key}" — expected one of ${known.join(', ')}`)
  }
  if (o.files !== undefined) {
    if (!Array.isArray(o.files) || o.files.some(f => typeof f !== 'string')) {
      throw new Error(`${source}: "files" must be an array of paths`)
    }
    out.files = o.files as string[]
  }
  if (o.min !== undefined) {
    if (typeof o.min !== 'string' || !['S', 'A', 'B', 'C', 'D'].includes(o.min.toUpperCase())) {
      throw new Error(`${source}: "min" must be one of S, A, B, C, D`)
    }
    out.min = o.min.toUpperCase()
  }
  for (const flag of ['wcag', 'dark'] as const) {
    if (o[flag] !== undefined) {
      if (typeof o[flag] !== 'boolean') throw new Error(`${source}: "${flag}" must be true or false`)
      out[flag] = o[flag] as boolean
    }
  }
  if (o.roles !== undefined) {
    if (!o.roles || typeof o.roles !== 'object' || Array.isArray(o.roles)) {
      throw new Error(`${source}: "roles" must be an object of role → token name`)
    }
    const ROLES = ['surface', 'card', 'muted', 'primary', 'accent', 'text']
    const roles: Record<string, string> = {}
    for (const [role, token] of Object.entries(o.roles as Record<string, unknown>)) {
      if (!ROLES.includes(role)) throw new Error(`${source}: "${role}" is not a role — expected one of ${ROLES.join(', ')}`)
      if (typeof token !== 'string') throw new Error(`${source}: roles.${role} must be a token name`)
      roles[role] = token
    }
    out.roles = roles
  }
  return out
}
