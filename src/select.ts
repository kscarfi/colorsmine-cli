import { coords, distance, type Token } from './color'

export interface Selection {
  hexes: string[]
  /** What each chosen color was chosen as, in the order of `hexes`. */
  picks: { role: string; token: Token }[]
  /** True when names carried the selection; false when it fell back to spread. */
  named: boolean
}

/**
 * A token file can hold four colors or four hundred. Grading all of them is
 * meaningless — `ratePalette` asks "would this ship as a UI", and that question
 * is about the handful of colors a screen is actually built from.
 *
 * So we look for the semantic names every convention converges on. shadcn/ui
 * writes `--background` / `--foreground` / `--muted-foreground`; Tailwind
 * projects write `colors.primary`; design systems write `surface` and `ink`.
 * When none of that is present we fall back to the most separated colors in
 * the file, which is the best guess available and is reported as a guess.
 */
/** Words that mark a token as the text drawn *on* something, not the thing. */
const FOREGROUND = /(^|[-._/])(foreground|fg|text|copy|ink|label|on)([-._/]|$)/i

interface Role {
  role: string
  test: RegExp
  /** Names that match `test` but mean something else. */
  not?: RegExp
  /** Shape strongly preferred when several tokens match. */
  bonus?: RegExp
  prefer: 'light' | 'dark' | 'mid' | 'chroma'
}

const ROLES: Role[] = [
  { role: 'surface', test: /(^|[-._/])(background|bg|surface|base|paper|canvas)([-._/]|$)/i, not: FOREGROUND, prefer: 'light' },
  { role: 'card', test: /(^|[-._/])(card|panel|popover|elevated|sheet)([-._/]|$)/i, not: FOREGROUND, prefer: 'light' },
  // shadcn/ui writes `--muted` for a light fill and `--muted-foreground` for the
  // grey text on it. Grading the fill as if it were text produces a 1.1:1
  // "failure" that says nothing about the palette, so the foreground variant
  // wins whenever one exists.
  { role: 'muted', test: /(^|[-._/])(muted|subtle|placeholder|hint|secondary|tertiary)([-._/]|$)/i, bonus: FOREGROUND, prefer: 'mid' },
  { role: 'primary', test: /(^|[-._/])(primary|brand|action)([-._/]|$)/i, not: FOREGROUND, prefer: 'chroma' },
  { role: 'accent', test: /(^|[-._/])(accent|highlight|link|info)([-._/]|$)/i, not: FOREGROUND, prefer: 'chroma' },
  // `--primary-foreground` is a label colour, not the body text; only a
  // foreground token with no other role in its name is the real ink.
  {
    role: 'text',
    test: /(^|[-._/])(foreground|text|fg|ink|copy|content)([-._/]|$)/i,
    not: /(muted|subtle|placeholder|hint|primary|brand|accent|secondary|tertiary|destructive|success|warning|error|info|card|popover|sidebar|inverse|invert)/i,
    prefer: 'dark',
  },
]

function best(matches: Token[], r: Role): Token {
  const score = (t: Token) => {
    const { l, c } = coords(t.hex)
    if (r.prefer === 'light') return l
    if (r.prefer === 'dark') return 1 - l
    if (r.prefer === 'chroma') return c
    return 1 - Math.abs(l - 0.55) // mid
  }
  const depth = (t: Token) => t.name.replace(/^--/, '').split(/[.\-_/]/).length
  return [...matches].sort((a, b) => {
    if (r.bonus) {
      const ba = r.bonus.test(a.name) ? 0 : 1
      const bb = r.bonus.test(b.name) ? 0 : 1
      if (ba !== bb) return ba - bb
    }
    // Shallower names are more semantic: `primary` beats `primary.hover.50`.
    const d = depth(a) - depth(b)
    return d !== 0 ? d : score(b) - score(a)
  })[0]
}

export function selectPalette(tokens: Token[]): Selection {
  const picks: { role: string; token: Token }[] = []
  const usedHex = new Set<string>()
  const usedName = new Set<string>()

  for (const r of ROLES) {
    let matches = tokens.filter(
      t => r.test.test(t.name) && !(r.not && r.not.test(t.name)) && !usedName.has(t.name) && !usedHex.has(t.hex),
    )
    // Surfaces are supposed to sit close together — paper and card differ by a
    // hair by design. Primary and accent are not: a token named `--accent` that
    // is indistinguishable from the surface isn't acting as an accent here, and
    // letting it into that slot makes the engine call a near-white the primary
    // and report a 1.09:1 failure against a role the file never assigned.
    if (r.role === 'primary' || r.role === 'accent') {
      const surface = picks.find(p => p.role === 'surface')?.token.hex ?? picks[0]?.token.hex
      if (surface) {
        const usable = matches.filter(t => distance(t.hex, surface) >= 0.06)
        if (usable.length) matches = usable
      }
    }
    if (!matches.length) continue
    const token = best(matches, r)
    picks.push({ role: r.role, token })
    usedHex.add(token.hex)
    usedName.add(token.name)
  }

  // Two named colors is not a palette; below that the names are telling us less
  // than the colors themselves would.
  if (picks.length >= 3) {
    return { hexes: picks.map(p => p.token.hex), picks, named: true }
  }
  return spread(tokens)
}

/** No usable names: take the lightest, the darkest, and the most separated rest. */
function spread(tokens: Token[]): Selection {
  const byHex = new Map<string, Token>()
  for (const t of tokens) if (!byHex.has(t.hex)) byHex.set(t.hex, t)
  const uniq = [...byHex.values()]
  if (uniq.length <= 5) {
    return { hexes: uniq.map(t => t.hex), picks: uniq.map(t => ({ role: '—', token: t })), named: false }
  }

  const sorted = [...uniq].sort((a, b) => coords(b.hex).l - coords(a.hex).l)
  const chosen: Token[] = [sorted[0], sorted[sorted.length - 1]]
  while (chosen.length < 5) {
    let bestT: Token | null = null
    let bestD = -1
    for (const t of uniq) {
      if (chosen.some(c => c.hex === t.hex)) continue
      const d = Math.min(...chosen.map(c => distance(c.hex, t.hex)))
      if (d > bestD) { bestD = d; bestT = t }
    }
    if (!bestT) break
    chosen.push(bestT)
  }
  const ordered = chosen.sort((a, b) => coords(b.hex).l - coords(a.hex).l)
  return { hexes: ordered.map(t => t.hex), picks: ordered.map(t => ({ role: '—', token: t })), named: false }
}
