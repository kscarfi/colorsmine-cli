import { toHex, type Token } from '../color'

/**
 * Selectors that mean "this block is the dark theme". `html.dark` and
 * `:root.dark` are as common as a bare `.dark`, so the class is matched as a
 * token anywhere in the selector rather than only at its start — anchoring on
 * whitespace silently graded those projects' light colors twice and reported
 * a modelled dark mode instead of theirs. `\b` keeps `.darkroom` out.
 */
const DARK_SELECTOR =
  /\.(dark|dark-mode|darkmode|theme-dark|mode-dark)\b|\[data-[\w-]*\s*[~|^$*]?=\s*["']?dark["']?\s*\]/i

/** `@media (prefers-color-scheme: dark)` — the other half of the ecosystem. */
const DARK_MEDIA = /prefers-color-scheme\s*:\s*dark/i

/**
 * Custom properties, wherever they live: `:root`, `[data-theme]`, Tailwind v4's
 * `@theme`, or a plain block. We deliberately don't resolve the cascade — a
 * color token is a color token regardless of specificity, and doing that
 * properly would mean shipping a CSS parser to answer a question nobody asked.
 *
 * What does have to be right is which theme a declaration belongs to, because
 * that decides whether `--dark` grades what the project wrote or a model of
 * what it might have written.
 */
export function readCss(text: string, source: string): { light: Token[]; dark: Token[] } {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const light: Token[] = []
  const dark: Token[] = []
  const seen = new Set<string>()

  const collect = (css: string, forceDark: boolean) => {
    const blockRe = /([^{}]*)\{([^{}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = blockRe.exec(css))) {
      const isDark = forceDark || DARK_SELECTOR.test(m[1])
      const declRe = /--([\w-]+)\s*:\s*([^;]+)/g
      let d: RegExpExecArray | null
      while ((d = declRe.exec(m[2]))) {
        const name = `--${d[1]}`
        const hex = toHex(d[2])
        if (!hex) continue
        const key = `${isDark ? 'd' : 'l'}:${name}`
        if (seen.has(key)) continue
        seen.add(key)
        ;(isDark ? dark : light).push({ name, hex, source })
      }
    }
  }

  // Conditional at-rules have to come out first: the block matcher above only
  // sees innermost braces, so a `:root` nested inside `@media
  // (prefers-color-scheme: dark)` would otherwise read as an ordinary
  // light-theme rule.
  const { rest, darkBlocks } = liftAtRules(clean)
  for (const block of darkBlocks) collect(block, true)
  collect(rest, false)

  return { light, dark }
}

/**
 * Pull conditional group rules out with balanced braces, returning the
 * dark-scheme ones separately and splicing everything else back in. Nesting is
 * flattened, which is enough here: the only question is whether a declaration
 * sits inside a dark-scheme condition, and wrapping that condition in another
 * one does not change the answer.
 */
function liftAtRules(css: string): { rest: string; darkBlocks: string[] } {
  const darkBlocks: string[] = []
  let rest = ''
  let i = 0

  while (i < css.length) {
    const at = css.indexOf('@', i)
    if (at === -1) {
      rest += css.slice(i)
      break
    }
    const open = css.indexOf('{', at)
    if (open === -1) {
      rest += css.slice(i)
      break
    }
    const prelude = css.slice(at, open)
    // `@theme { … }` holds declarations directly; only conditional group rules
    // wrap other rules, and only those need lifting.
    if (!/^@(media|supports|container|layer)\b/i.test(prelude.trim())) {
      rest += css.slice(i, open + 1)
      i = open + 1
      continue
    }

    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)
    rest += css.slice(i, at)

    const inner = liftAtRules(body)
    if (DARK_MEDIA.test(prelude)) {
      darkBlocks.push(inner.rest, ...inner.darkBlocks)
    } else {
      rest += inner.rest
      darkBlocks.push(...inner.darkBlocks)
    }
    i = j
  }

  return { rest, darkBlocks }
}
