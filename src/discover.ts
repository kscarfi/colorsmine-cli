import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, relative, extname, basename } from 'node:path'
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
      notes.push(`${relative(cwd, file)}: no such file`)
      continue
    }
    const text = await readFile(file, 'utf8')
    const source = relative(cwd, file) || basename(file)
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
