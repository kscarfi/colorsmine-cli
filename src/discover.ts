import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { resolve, relative, extname, basename, sep } from 'node:path'
import type { Token } from './color'
import { readCss } from './readers/css'
import { readJson } from './readers/json'
import { readTailwind } from './readers/tailwind'

/** Where token files live in the projects this will actually be run against. */
const CANDIDATES = [
  'tokens.json',
  'design-tokens.json',
  'tokens/tokens.json',
  'src/tokens.json',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'tailwind.config.ts',
  'src/globals.css',
  'src/index.css',
  'src/app.css',
  'app/globals.css',
  'styles/globals.css',
  'src/styles/globals.css',
  'app/styles/globals.css',
]

/**
 * Paths are reported with forward slashes on every platform. `relative()`
 * hands back `src\\globals.css` on Windows, which would make the JSON output
 * — and any annotation or issue someone pastes it into — depend on the OS that
 * happened to run the check. Git, npm and CI logs all speak forward slashes.
 */
const posix = (p: string) => p.split(sep).join('/')

export interface ReadResult {
  tokens: Token[]
  darkTokens: Token[]
  files: string[]
  notes: string[]
}

export function discover(cwd: string): string[] {
  return CANDIDATES.map(c => resolve(cwd, c)).filter(p => existsSync(p))
}

export async function readAll(files: string[], cwd: string): Promise<ReadResult> {
  const tokens: Token[] = []
  const darkTokens: Token[] = []
  const notes: string[] = []
  const used: string[] = []

  for (const file of files) {
    if (!existsSync(file)) {
      notes.push(`${posix(relative(cwd, file))}: no such file`)
      continue
    }
    // `colorsmine check src/` is a reasonable thing to type. Look for the
    // usual token files inside rather than letting readFile throw EISDIR at
    // the user with a stack-trace-shaped message.
    if (statSync(file).isDirectory()) {
      // CANDIDATES are paths relative to the project root, so joining them
      // onto a directory would look for src/src/globals.css. Inside a
      // directory it is the file names that matter.
      // Both forms: the relative paths make `check .` behave like a bare
      // `check`, the bare names make `check src/` find src/globals.css.
      const names = [...new Set([...CANDIDATES, ...CANDIDATES.map(c => basename(c))])]
      const inside = names
        .map(n => resolve(file, n))
        .filter(p => existsSync(p) && !statSync(p).isDirectory())
      if (!inside.length) {
        notes.push(`${posix(relative(cwd, file)) || '.'}: a directory with no token file in it`)
        continue
      }
      const nested = await readAll(inside, cwd)
      tokens.push(...nested.tokens)
      darkTokens.push(...nested.darkTokens)
      notes.push(...nested.notes)
      used.push(...nested.files)
      continue
    }
    const text = await readFile(file, 'utf8')
    const source = posix(relative(cwd, file)) || basename(file)
    const ext = extname(file)

    if (ext === '.css') {
      const { light, dark } = readCss(text, source)
      tokens.push(...light)
      darkTokens.push(...dark)
    } else if (ext === '.json') {
      tokens.push(...readJson(text, source))
    } else if (/tailwind\.config/.test(basename(file))) {
      const { tokens: t, evaluated } = await readTailwind(file, text, source)
      tokens.push(...t)
      if (!evaluated) notes.push(`${source}: read as text (config was not importable), so computed colors are missing`)
    } else {
      notes.push(`${source}: unsupported file type — pass a .css, .json or tailwind.config.*`)
      continue
    }
    used.push(source)
  }

  return { tokens, darkTokens, files: used, notes }
}
