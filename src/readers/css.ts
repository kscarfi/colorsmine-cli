import { toHex, type Token } from '../color'

/**
 * Custom properties, wherever they live: `:root`, `[data-theme]`, Tailwind v4's
 * `@theme`, or a plain block. We deliberately don't parse selectors — a color
 * token is a color token regardless of which rule declares it, and scoping it
 * correctly would mean shipping a CSS parser to answer a question nobody asked.
 *
 * Declarations under a `.dark`/`[data-theme="dark"]` block are collected
 * separately so `--dark` can grade the theme the palette actually ships.
 */
export function readCss(text: string, source: string): { light: Token[]; dark: Token[] } {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const light: Token[] = []
  const dark: Token[] = []
  const seen = new Set<string>()

  // Walk blocks so a declaration can be attributed to its selector.
  const blockRe = /([^{}]*)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(clean))) {
    const selector = m[1].trim()
    const body = m[2]
    const isDark = /(^|[\s,])(\.dark|\[data-theme\s*[~|^$*]?=\s*["']?dark)/i.test(selector)
    const declRe = /--([\w-]+)\s*:\s*([^;]+)/g
    let d: RegExpExecArray | null
    while ((d = declRe.exec(body))) {
      const name = `--${d[1]}`
      const hex = toHex(d[2])
      if (!hex) continue
      const key = `${isDark ? 'd' : 'l'}:${name}`
      if (seen.has(key)) continue
      seen.add(key)
      ;(isDark ? dark : light).push({ name, hex, source })
    }
  }
  return { light, dark }
}
