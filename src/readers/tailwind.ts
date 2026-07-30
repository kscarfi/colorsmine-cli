import { pathToFileURL } from 'node:url'
import { toHex, type Token } from '../color'

/**
 * A Tailwind config is code, so the honest read is to execute it — that is the
 * only way `require('tailwindcss/colors')`, spreads and helper functions come
 * out right. But configs are also written in TypeScript, import plugins that
 * aren't installed, or throw on load, and refusing to grade in those cases
 * would fail the build for a reason that has nothing to do with color.
 *
 * So: import when we can, and fall back to reading the object literal as text
 * when we can't. The caller is told which path was taken.
 */
export async function readTailwind(
  file: string,
  text: string,
  source: string,
): Promise<{ tokens: Token[]; evaluated: boolean }> {
  if (/\.(js|cjs|mjs)$/.test(file)) {
    try {
      const mod = await import(pathToFileURL(file).href)
      const cfg = mod?.default ?? mod
      const colors = cfg?.theme?.extend?.colors ?? cfg?.theme?.colors
      if (colors && typeof colors === 'object') {
        return { tokens: fromObject(colors, source), evaluated: true }
      }
    } catch {
      // fall through to the text scan
    }
  }
  return { tokens: scanLiteral(text, source), evaluated: false }
}

function fromObject(colors: Record<string, unknown>, source: string): Token[] {
  const out: Token[] = []
  const walk = (node: unknown, path: string[]) => {
    if (typeof node === 'string') {
      const hex = toHex(node)
      if (hex) out.push({ name: path.join('.'), hex, source })
      return
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, [...path, k])
  }
  walk(colors, [])
  return out
}

/**
 * Read `key: 'value'` pairs out of a JS object literal without evaluating it.
 * Tracks nesting so paths come out as `colors.brand.500`, and skips comments
 * and string bodies so a `#` inside a string can't be mistaken for a comment.
 */
function scanLiteral(src: string, source: string): Token[] {
  const found: { path: string[]; value: string }[] = []
  const stack: string[] = []
  let pending: string | null = null
  let i = 0

  const skipTrivia = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++
      if (src.startsWith('//', i)) {
        while (i < src.length && src[i] !== '\n') i++
      } else if (src.startsWith('/*', i)) {
        const end = src.indexOf('*/', i + 2)
        i = end === -1 ? src.length : end + 2
      } else return
    }
  }

  const readString = (): string | null => {
    const quote = src[i]
    if (quote !== '"' && quote !== "'" && quote !== '`') return null
    let out = ''
    i++
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') i++
      out += src[i]
      i++
    }
    i++ // closing quote
    return out
  }

  while (i < src.length) {
    skipTrivia()
    if (i >= src.length) break
    const ch = src[i]

    if (ch === '{') {
      stack.push(pending ?? '')
      pending = null
      i++
      continue
    }
    if (ch === '}') {
      stack.pop()
      pending = null
      i++
      continue
    }
    if (ch === ':') {
      i++
      skipTrivia()
      const str = readString()
      if (str !== null && pending !== null) found.push({ path: [...stack, pending], value: str })
      if (str !== null) pending = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const key = readString()
      if (key !== null) pending = key
      continue
    }
    if (/[\w-]/.test(ch)) {
      let word = ''
      while (i < src.length && /[\w-]/.test(src[i])) word += src[i++]
      pending = word
      continue
    }
    // punctuation we don't care about (commas, parens, operators)
    pending = ch === ',' ? null : pending
    i++
  }

  const tokens: Token[] = []
  const seen = new Set<string>()
  for (const { path, value } of found) {
    const hex = toHex(value)
    if (!hex) continue
    const name = path.filter(Boolean).join('.')
    if (seen.has(name)) continue
    seen.add(name)
    tokens.push({ name, hex, source })
  }
  // Configs carry plenty of non-color strings; when a `colors` block exists,
  // trust it and drop everything outside it.
  const inColors = tokens.filter(t => /(^|\.)colors?(\.|$)/i.test(t.name))
  return inColors.length ? inColors : tokens
}
