// ⚠️  Vendored from the ColorsMine app — do not edit here.
// Source: src/lib/roleSelection.ts · sync: `node scripts/sync-engine.mjs <path>`
// Editing this copy makes the CLI grade differently from colorsmine.com,
// which is the one thing this package promises cannot happen.

import { oklch, parse } from 'culori'

/**
 * Which colors out of a set are the palette, and what each one is for.
 *
 * This is shared on purpose. The CLI reads names out of a CSS or JSON token
 * file, the Figma plugin reads them off a variable collection, and the two
 * must agree — a palette that grades A in Figma and B in CI is worse than no
 * grade at all. Everything here works on a name and a hex, which is all
 * either side actually has.
 */
export interface NamedColor {
  /** `--muted-foreground`, `colors.brand.500`, `semantic/text` — as written. */
  name: string
  hex: string
}

/** Perceptual coordinates, used for role preference and distinctness. */
export function coords(hex: string): { l: number; c: number; h: number } {
  const o = oklch(parse(hex)) as any
  return { l: o?.l ?? 0, c: o?.c ?? 0, h: o?.h ?? 0 }
}

export function distance(a: string, b: string): number {
  const x = coords(a), y = coords(b)
  const dh = ((x.h - y.h + 540) % 360) - 180
  // Hue only matters in proportion to how much chroma carries it.
  const chroma = Math.min(x.c, y.c)
  return Math.hypot(x.l - y.l, x.c - y.c, (dh / 180) * chroma)
}


export interface RoleSelection {
  hexes: string[]
  /** What each chosen color was chosen as, in the order of `hexes`. */
  picks: { role: string; color: NamedColor; pinned: boolean }[]
  /** True when names carried the selection; false when it fell back to spread. */
  named: boolean
  /** Roles no distinct color could be found for — the actionable gap. */
  missing: string[]
  /** Colors in the file that no role claimed, as pinning candidates. */
  ungraded: NamedColor[]
  /**
   * Every role a name or an override resolved, as hexes, for the engine to
   * honour instead of re-deriving.
   *
   * This matters most in the direction lightness cannot see. A dark theme
   * naming `background: #0a0a0a` and `foreground: #fafafa` is unambiguous, but
   * inference reads the lightest color as the surface — so it graded an
   * inverted light theme and reported a clean A on a theme whose muted text
   * sits at 1.9:1. Names beat guesses; `picks[].pinned` still records which of
   * them a person chose.
   */
  roles: Record<string, string>
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
/** Words that mark a color as the text drawn *on* something, not the thing. */
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
  // foreground color with no other role in its name is the real ink.
  {
    role: 'text',
    test: /(^|[-._/])(foreground|text|fg|ink|copy|content)([-._/]|$)/i,
    not: /(muted|subtle|placeholder|hint|primary|brand|accent|secondary|tertiary|destructive|success|warning|error|info|card|popover|sidebar|inverse|invert)/i,
    prefer: 'dark',
  },
]

function best(matches: NamedColor[], r: Role): NamedColor {
  const score = (t: NamedColor) => {
    const { l, c } = coords(t.hex)
    if (r.prefer === 'light') return l
    if (r.prefer === 'dark') return 1 - l
    if (r.prefer === 'chroma') return c
    return 1 - Math.abs(l - 0.55) // mid
  }
  const depth = (t: NamedColor) => t.name.replace(/^--/, '').split(/[.\-_/]/).length
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

/**
 * A token file can name its roles in ways no heuristic anticipates —
 * `bg-raised` for a card, `text-dim` for muted text. When that happens the
 * colors are silently dropped and the grade covers a smaller palette than the
 * one that shipped, which reads as a better palette rather than a partial
 * reading. Overrides are how a project says what its own names mean.
 */
export type RoleOverrides = Record<string, string>

export function selectRoles(tokens: NamedColor[], overrides: RoleOverrides = {}): RoleSelection {
  const picks: { role: string; color: NamedColor; pinned: boolean }[] = []
  const usedHex = new Set<string>()
  const usedName = new Set<string>()
  const missing: string[] = []
  const resolved: Record<string, string> = {}

  // Pins first, so an override can claim a color before the heuristic spends
  // it on another role.
  for (const r of ROLES) {
    const want = overrides[r.role]
    if (!want) continue
    const color = tokens.find(t => t.name === want || t.name === `--${want}` || t.name.replace(/^--/, '') === want)
    if (!color) continue
    picks.push({ role: r.role, color, pinned: true })
    resolved[r.role] = color.hex
    usedHex.add(color.hex)
    usedName.add(color.name)
  }

  for (const r of ROLES) {
    if (picks.some(p => p.role === r.role)) continue
    let matches = tokens.filter(
      t => r.test.test(t.name) && !(r.not && r.not.test(t.name)) && !usedName.has(t.name) && !usedHex.has(t.hex),
    )
    // Surfaces are supposed to sit close together — paper and card differ by a
    // hair by design. Primary and accent are not: a color named `--accent` that
    // is indistinguishable from the surface isn't acting as an accent here, and
    // letting it into that slot makes the engine call a near-white the primary
    // and report a 1.09:1 failure against a role the file never assigned.
    if (r.role === 'primary' || r.role === 'accent') {
      const surface = picks.find(p => p.role === 'surface')?.color.hex ?? picks[0]?.color.hex
      if (surface) {
        const usable = matches.filter(t => distance(t.hex, surface) >= 0.06)
        if (usable.length) matches = usable
      }
    }
    if (!matches.length) {
      // `accent` is genuinely optional; the other five are what a screen needs.
      if (r.role !== 'accent') missing.push(r.role)
      continue
    }
    const color = best(matches, r)
    picks.push({ role: r.role, color, pinned: false })
    resolved[r.role] = color.hex
    usedHex.add(color.hex)
    usedName.add(color.name)
  }

  const ungraded = tokens.filter(t => !usedName.has(t.name) && !usedHex.has(t.hex))

  // Two named colors is not a palette; below that the names are telling us less
  // than the colors themselves would.
  if (picks.length >= 3) {
    // Order follows lightness so the strip reads light → dark like the report.
    picks.sort((a, b) => coords(b.color.hex).l - coords(a.color.hex).l)
    return {
      hexes: picks.map(p => p.color.hex),
      picks,
      named: true,
      missing,
      ungraded,
      roles: resolved,
    }
  }
  return spread(tokens)
}

/** No usable names: take the lightest, the darkest, and the most separated rest. */
function spread(tokens: NamedColor[]): RoleSelection {
  const byHex = new Map<string, NamedColor>()
  for (const t of tokens) if (!byHex.has(t.hex)) byHex.set(t.hex, t)
  const uniq = [...byHex.values()]
  if (uniq.length <= 5) {
    return {
      hexes: uniq.map(t => t.hex),
      picks: uniq.map(t => ({ role: '—', color: t, pinned: false })),
      named: false, missing: [], ungraded: [], roles: {},
    }
  }

  const sorted = [...uniq].sort((a, b) => coords(b.hex).l - coords(a.hex).l)
  const chosen: NamedColor[] = [sorted[0], sorted[sorted.length - 1]]
  while (chosen.length < 5) {
    let bestT: NamedColor | null = null
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
  return {
    hexes: ordered.map(t => t.hex),
    picks: ordered.map(t => ({ role: '—', color: t, pinned: false })),
    named: false,
    missing: [],
    ungraded: uniq.filter(t => !ordered.some(o => o.hex === t.hex)),
    // Nothing was named, so there is nothing to tell the engine.
    roles: {},
  }
}
