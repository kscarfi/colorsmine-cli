// ⚠️  Vendored from the ColorsMine app — do not edit here.
// Source: src/lib/paletteRating.ts · sync: `node scripts/sync-engine.mjs <path>`
// Editing this copy makes the CLI grade differently from colorsmine.com,
// which is the one thing this package promises cannot happen.

// "Roast my palette" — a report card for any set of hexes. Pure math on top
// of the same engines the catalog gates use: WCAG pairs, color-blind
// separability, hue-relation harmony, perceptual spacing. Deterministic, so
// a score is defensible when someone shares it.

import { clampChroma, formatHex, oklch, parse } from 'culori'
import { getContrast } from 'color2k'
import { simulateColorBlindness } from './colorBlindness'
import { apcaContrast } from './contrastValidator'
import { nearestColorName } from './colorNaming'

export interface RatingPart {
  label: string
  score: number // 0..1
  detail: string
}

/** The job each color would be given if this palette shipped. */
export interface PaletteRoles {
  surface: string
  card: string
  /** Secondary text — only distinct from `text` when a quiet mid-tone exists. */
  muted: string
  primary: string
  text: string
  /** A second chromatic color, used for links, icons and badges. */
  accent?: string
}

/** One pairing a designer would actually build, and whether it holds up. */
export interface Pairing {
  label: string
  fg: string
  bg: string
  ratio: number
  /** WCAG minimum for this use: 4.5 body text, 3 large text and UI parts. */
  required: number
  passes: boolean
  /** APCA lightness contrast — the perceptual model WCAG 2.x approximates. */
  apca: number
  kind: 'text' | 'non-text'
}

/** The smallest single change that moves the grade. */
export interface PaletteFix {
  index: number
  from: string
  to: string
  move: string
  reason: string
  overallBefore: number
  overallAfter: number
  gradeBefore: Grade
  gradeAfter: Grade
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'

export interface PaletteRating {
  overall: number // 0..100
  grade: Grade
  verdict: string
  roast: string
  parts: RatingPart[]
  aaPairs: { fg: string; bg: string; ratio: number }[]
  /** Roles inferred from lightness and chroma — what the colors would do. */
  roles: PaletteRoles
  /** The pairings those roles imply, scored against their own requirement. */
  pairings: Pairing[]
  /** Worst-case color-vision result across the three dichromacies. */
  cvd: { worst: 'deuteranopia' | 'protanopia' | 'tritanopia'; score: number }
  /** Survives a photocopier / total color blindness. */
  greyscaleSafe: boolean
  /**
   * The same colors with the roles flipped — darkest becomes the surface,
   * lightest becomes the text. Dark mode is where palettes quietly fail: the
   * hue relations survive, the pairings do not.
   */
  dark: { overall: number; grade: Grade; pairings: Pairing[] }
}

type Okl = [number, number, number] // L, C, H

function toOkl(hex: string): Okl | null {
  const o = oklch(parse(hex))
  if (!o) return null
  return [o.l ?? 0, o.c ?? 0, o.h ?? 0]
}

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function gradeFor(overall: number): Grade {
  return overall >= 90 ? 'S' : overall >= 75 ? 'A' : overall >= 60 ? 'B' : overall >= 45 ? 'C' : 'D'
}

export function parseHexes(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of input.matchAll(/#?([0-9a-fA-F]{6})\b/g)) {
    const hex = '#' + m[1].toLowerCase()
    if (!seen.has(hex)) { seen.add(hex); out.push(hex) }
  }
  return out.slice(0, 8)
}

/**
 * What each color would end up doing. Scoring five colors as an unordered bag
 * flatters a palette: it answers "does SOME pair pass?" when the question is
 * "do the pairs you would actually build pass?". A grey-blue set where white
 * on near-black clears 17:1 scored a perfect contrast axis while its muted
 * text sat at 2.45:1 — unreadable, and shipped.
 */
function inferRoles(hexes: string[], O: Okl[]): PaletteRoles {
  const byLight = hexes.map((hex, i) => ({ hex, l: O[i][0], c: O[i][1] })).sort((a, b) => b.l - a.l)
  const surface = byLight[0].hex
  const text = byLight[byLight.length - 1].hex
  // A card is a second surface, so it has to be light and near-neutral. Taking
  // "whatever is second lightest" handed the role to a vivid cyan and then
  // failed the palette for text on it — a pairing nobody would build.
  const cardCandidate = byLight.slice(1, -1).find(x => x.l >= 0.8 && x.c <= 0.06)
  const card = cardCandidate?.hex ?? surface
  // Primary is the statement color: most chroma, but never the paper or the ink
  const middle = byLight.slice(1, -1)
  const pool = middle.length ? middle : byLight
  const primary = [...pool].sort((a, b) => b.c - a.c)[0].hex
  // Muted is secondary text — but only if the palette actually carries a
  // quiet mid-tone for it. A four-color set of paper, ink, primary and accent
  // has no muted text, and failing it for one is a fabricated complaint.
  const mid = (byLight[0].l + byLight[byLight.length - 1].l) / 2
  const quiet = pool
    .filter(x => x.hex !== primary && x.c <= 0.08)
    .sort((a, b) => Math.abs(a.l - mid) - Math.abs(b.l - mid))
  const muted = quiet[0]?.hex ?? text
  // Whatever chromatic member isn't the primary still gets used — as a link,
  // an icon, a badge — so it is checked against the non-text 3:1 rule.
  const accentPool = pool.filter(x => x.hex !== primary && x.c > 0.08)
  const accent = [...accentPool].sort((a, b) => b.c - a.c)[0]?.hex
  return { surface, card, muted, primary, text, accent }
}

/** The same palette, read for a dark interface. */
function inferDarkRoles(hexes: string[], O: Okl[]): PaletteRoles {
  const byDark = hexes.map((hex, i) => ({ hex, l: O[i][0], c: O[i][1] })).sort((a, b) => a.l - b.l)
  const surface = byDark[0].hex
  const text = byDark[byDark.length - 1].hex
  // An elevated dark surface: still dark, still near-neutral
  const card = byDark.slice(1, -1).find(x => x.l <= 0.35 && x.c <= 0.06)?.hex ?? surface
  const middle = byDark.slice(1, -1)
  const pool = middle.length ? middle : byDark
  const primary = [...pool].sort((a, b) => b.c - a.c)[0].hex
  const mid = (byDark[0].l + byDark[byDark.length - 1].l) / 2
  const quiet = pool.filter(x => x.hex !== primary && x.c <= 0.08)
    .sort((a, b) => Math.abs(a.l - mid) - Math.abs(b.l - mid))
  const muted = quiet[0]?.hex ?? text
  const accent = [...pool.filter(x => x.hex !== primary && x.c > 0.08)].sort((a, b) => b.c - a.c)[0]?.hex
  return { surface, card, muted, primary, text, accent }
}

function labelOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111111' : '#ffffff'
}

/**
 * The pairings a real interface makes, each against its own WCAG minimum:
 * 4.5:1 for body text, 3:1 for large text and — the rule no palette tool
 * checks — for interface parts like button fills and borders (WCAG 2.2 1.4.11).
 */
function buildPairings(roles: PaletteRoles): Pairing[] {
  const make = (label: string, fg: string, bg: string, required: number, kind: 'text' | 'non-text'): Pairing => {
    const ratio = Math.round(getContrast(fg, bg) * 100) / 100
    return { label, fg, bg, ratio, required, passes: ratio >= required, apca: Math.round(apcaContrast(fg, bg)), kind }
  }
  const out: Pairing[] = [make('Body text on surface', roles.text, roles.surface, 4.5, 'text')]
  if (roles.card !== roles.surface) out.push(make('Body text on card', roles.text, roles.card, 4.5, 'text'))
  if (roles.muted !== roles.text) out.push(make('Muted text on surface', roles.muted, roles.surface, 4.5, 'text'))
  if (roles.primary !== roles.text && roles.primary !== roles.surface) {
    out.push(make('Button label on primary', labelOn(roles.primary), roles.primary, 4.5, 'text'))
    out.push(make('Primary against surface', roles.primary, roles.surface, 3, 'non-text'))
  }
  if (roles.accent && roles.accent !== roles.primary) {
    out.push(make('Accent icon on surface', roles.accent, roles.surface, 3, 'non-text'))
  }
  return out
}

/**
 * Roles the caller already knows, because it read them from named tokens or a
 * designer pinned them. Inference is a good guess about an anonymous list of
 * colors; it is only a guess, and when the caller has better information it
 * should win. Anything left out is still inferred.
 */
export interface RateOptions {
  roles?: Partial<PaletteRoles>
}

export function ratePalette(hexes: string[], opts: RateOptions = {}): PaletteRating | null {
  if (hexes.length < 2) return null
  const okls = hexes.map(toOkl)
  if (okls.some(o => o === null)) return null
  const O = okls as Okl[]
  const n = hexes.length

  // Best available pairs stay in the report — they are the "use these" answer
  const aaPairs: { fg: string; bg: string; ratio: number }[] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const ratio = getContrast(hexes[i], hexes[j])
    if (ratio >= 4.5) {
      const [fg, bg] = O[i][0] < O[j][0] ? [hexes[i], hexes[j]] : [hexes[j], hexes[i]]
      aaPairs.push({ fg, bg, ratio: Math.round(ratio * 10) / 10 })
    }
  }
  aaPairs.sort((a, b) => b.ratio - a.ratio)

  // ── 1. Contrast: the pairings this palette actually implies ──────────────
  // Only roles whose color is actually in the palette can be honoured — a
  // pinned token that was filtered out earlier would build a pairing against
  // a color nothing else was scored against.
  const present = new Set(hexes.map(h => h.toLowerCase()))
  const pinned = Object.fromEntries(
    Object.entries(opts.roles ?? {}).filter(([, hex]) => typeof hex === 'string' && present.has(hex.toLowerCase())),
  ) as Partial<PaletteRoles>
  const roles: PaletteRoles = { ...inferRoles(hexes, O), ...pinned }
  const pairings = buildPairings(roles)
  const passed = pairings.filter(p => p.passes).length
  const contrastScore = pairings.length ? passed / pairings.length : 0
  const failing = pairings.filter(p => !p.passes)

  // ── 2. Color vision: all three dichromacies, worst one decides ──────────
  const TYPES = ['deuteranopia', 'protanopia', 'tritanopia'] as const
  const perType = TYPES.map(type => {
    let min = Infinity
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = toOkl(simulateColorBlindness(hexes[i], type))
      const b = toOkl(simulateColorBlindness(hexes[j], type))
      if (!a || !b) continue
      const dh = hueDelta(a[2], b[2]) / 180
      min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], dh * 0.3))
    }
    return { type, score: Math.min(1, min / 0.09) }
  })
  const worstCvd = perType.reduce((a, b) => (b.score < a.score ? b : a))
  const cvdScore = worstCvd.score
  // Total color blindness — and every photocopier: lightness alone must carry
  const greys = hexes.map(h => toOkl(simulateColorBlindness(h, 'achromatopsia'))?.[0] ?? 0).sort((a, b) => a - b)
  const greyscaleSafe = greys.every((l, i) => i === 0 || l - greys[i - 1] >= 0.045)

  // ── 3. Harmony: chromatic members should relate by hue, not collide ──────
  const chromatic = O.filter(o => o[1] > 0.05)
  let harmonyScore = 0.7 // near-neutral palettes are "safe" rather than harmonious
  if (chromatic.length >= 2) {
    let best = 0, count = 0
    for (let i = 0; i < chromatic.length; i++) for (let j = i + 1; j < chromatic.length; j++) {
      const d = hueDelta(chromatic[i][2], chromatic[j][2])
      // Reward classic relations: analogous ≤35, complementary ~180, split ~150/210, triadic ~120
      // Continuous out to 75° — the old curve gave a flat zero to hues 45°
      // apart, which is how half the palettes in print are built.
      const rel = Math.max(
        1 - d / 75,
        1 - Math.abs(d - 180) / 60,
        1 - Math.abs(d - 150) / 50,
        1 - Math.abs(d - 120) / 50,
      )
      best += Math.max(0, Math.min(1, rel)); count++
    }
    harmonyScore = count ? best / count : 0.7
  }

  // ── 4. Spacing: no two members should be near-duplicates ─────────────────
  let minSep = Infinity
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dh = hueDelta(O[i][2], O[j][2]) / 180
    minSep = Math.min(minSep, Math.hypot(O[i][0] - O[j][0], O[i][1] - O[j][1], dh * 0.25))
  }
  const spacingScore = Math.min(1, minSep / 0.07)

  // ── 5. Range: does it have light + dark anchors a UI needs? ──────────────
  const ls = O.map(o => o[0])
  const range = Math.max(...ls) - Math.min(...ls)
  const rangeScore = Math.min(1, range / 0.55)

  const parts: RatingPart[] = [
    {
      label: 'Contrast',
      score: contrastScore,
      detail: failing.length === 0
        ? `All ${pairings.length} pairings this palette implies meet WCAG`
        : `${failing.length} of ${pairings.length} pairings fail: ${failing.map(f => `${f.label.toLowerCase()} at ${f.ratio}:1`).join(', ')}`,
    },
    {
      label: 'Color-blind safety',
      score: cvdScore,
      detail: cvdScore >= 1
        ? `All colors stay distinct under every dichromacy${greyscaleSafe ? ', and in greyscale' : ''}`
        : `Colors collapse together under ${worstCvd.type}${greyscaleSafe ? '' : ', and in greyscale'}`,
    },
    { label: 'Harmony', score: harmonyScore, detail: chromatic.length >= 2 ? 'Hue relations across chromatic members' : 'Mostly neutral — harmony is trivially safe' },
    { label: 'Distinctness', score: spacingScore, detail: spacingScore >= 1 ? 'Every color earns its place' : 'Two colors are nearly the same' },
    { label: 'Tonal range', score: rangeScore, detail: rangeScore >= 1 ? 'Light-to-dark span covers real UI needs' : 'Narrow lightness span — text/surface roles will struggle' },
  ]

  const overall = Math.round(
    100 * (0.34 * contrastScore + 0.2 * cvdScore + 0.2 * harmonyScore + 0.13 * spacingScore + 0.13 * rangeScore),
  )
  const grade = gradeFor(overall)

  const verdict =
    grade === 'S' ? 'Ship it. Frame it. Tattoo it.'
    : grade === 'A' ? 'Ship it — this palette does real work.'
    : grade === 'B' ? 'Solid base, a couple of soft spots.'
    : grade === 'C' ? 'Pretty, maybe. Production-ready, no.'
    : 'This palette needs a lawyer.'

  const worst = [...parts].sort((a, b) => a.score - b.score)[0]
  const roastLines: Record<string, string> = {
    'Contrast': failing.length
      ? `${failing[0].label} lands at ${failing[0].ratio}:1 — WCAG wants ${failing[0].required}:1, so that text is a squint test.`
      : 'Text on these colors is a squint test.',
    'Color-blind safety': `For 1 in 12 men, some of these are the same color — ${worstCvd.type} is where it breaks.`,
    'Harmony': 'These hues aren’t a palette, they’re strangers sharing an elevator.',
    'Distinctness': 'Two of these colors are the same color wearing different name tags.',
    'Tonal range': 'All mids, no anchors — where does the text go?',
  }
  // A-grade palettes get grudging respect, not a roast for their weakest stat
  const roast = overall >= 75 || worst.score >= 0.85
    ? `Honestly? Hard to roast. ${nearestColorName(hexes[0])} and friends know what they’re doing.`
    : roastLines[worst.label]

  // Dark mode reuses everything that belongs to the colors themselves — hue
  // relations, separation, range, color vision — and re-tests only what the
  // theme changes: which pairings you end up building.
  const darkPairings = buildPairings(inferDarkRoles(hexes, O))
  const darkContrast = darkPairings.length ? darkPairings.filter(p => p.passes).length / darkPairings.length : 0
  const darkOverall = Math.round(
    100 * (0.34 * darkContrast + 0.2 * cvdScore + 0.2 * harmonyScore + 0.13 * spacingScore + 0.13 * rangeScore),
  )

  return {
    overall, grade, verdict, roast, parts,
    aaPairs: aaPairs.slice(0, 3),
    roles, pairings,
    cvd: { worst: worstCvd.type, score: worstCvd.score },
    greyscaleSafe,
    dark: { overall: darkOverall, grade: gradeFor(darkOverall), pairings: darkPairings },
  }
}

/**
 * From diagnosis to prescription — the part every other tool stops short of.
 * WebAIM, Stark and the rest tell you a pair fails; none of them tell you what
 * to change. Lightness is the lever: it moves WCAG contrast, it survives every
 * color-vision deficiency (hue does not), and it is what separates members in
 * greyscale. So the search is one-dimensional and exhaustive: nudge each color
 * up and down in OKLCH lightness and keep the smallest move that lifts the
 * grade — or, failing that, the one that buys the most points per unit of
 * change. Deterministic, so the advice is the same every time it is asked.
 */
/** Follow pinned roles through a color change. */
function remapRoles(opts: RateOptions, from: string, to: string): RateOptions {
  if (!opts.roles) return opts
  const roles: Record<string, string> = {}
  for (const [role, hex] of Object.entries(opts.roles)) {
    if (typeof hex !== 'string') continue
    roles[role] = hex.toLowerCase() === from.toLowerCase() ? to : hex
  }
  return { roles: roles as Partial<PaletteRoles> }
}

export function suggestFix(hexes: string[], opts: RateOptions = {}): PaletteFix | null {
  const before = ratePalette(hexes, opts)
  if (!before || before.overall >= 97) return null

  const STEPS = 24          // ±0.48 lightness, in 0.02 increments
  const STEP = 0.02
  let best: (PaletteFix & { cost: number; gain: number }) | null = null

  for (let i = 0; i < hexes.length; i++) {
    const o = oklch(parse(hexes[i]))
    if (!o) continue
    for (let k = 1; k <= STEPS; k++) {
      for (const dir of [-1, 1]) {
        const l = (o.l ?? 0) + dir * k * STEP
        if (l <= 0.04 || l >= 0.99) continue
        const moved = formatHex(clampChroma({ mode: 'oklch', l, c: o.c ?? 0, h: o.h ?? 0 }, 'oklch'))
        if (!moved || moved.toLowerCase() === hexes[i].toLowerCase()) continue
        const candidate = [...hexes]
        candidate[i] = moved
        // A pinned role points at a hex. Moving that hex would leave the
        // pin dangling, the candidate would fall back to inference, and the
        // before/after comparison would be between two different rulesets.
        const after = ratePalette(candidate, remapRoles(opts, hexes[i], moved))
        if (!after || after.overall <= before.overall) continue

        const gain = after.overall - before.overall
        const cost = k * STEP
        const liftsGrade = after.grade !== before.grade
        // A grade change at the smallest cost wins; otherwise best points per
        // unit moved, so "recolor everything" never beats "nudge one thing".
        const rank = (liftsGrade ? 1000 : 0) - cost * 100 + gain
        const bestRank = best ? (best.gradeAfter !== best.gradeBefore ? 1000 : 0) - best.cost * 100 + best.gain : -Infinity
        if (rank <= bestRank) continue

        // "30% darker" reads as a relative change; the honest label is where
        // the lightness lands, since that is what the math moved.
        const fromL = Math.round((o.l ?? 0) * 100)
        const toL = Math.round(l * 100)
        const fixed = before.pairings
          .filter(p => !p.passes)
          .filter(p => after.pairings.find(q => q.label === p.label)?.passes)
        const reason = fixed.length
          ? `${fixed.map(f => f.label.toLowerCase()).join(' and ')} now clears WCAG`
          : after.cvd.score > before.cvd.score ? 'colors stay distinct for color-blind viewers'
          : `${before.parts.slice().sort((a, b) => a.score - b.score)[0].label.toLowerCase()} improves`
        best = {
          index: i,
          from: hexes[i],
          to: moved,
          move: `${dir < 0 ? 'darker' : 'lighter'} — lightness ${fromL}% → ${toL}%`,
          reason,
          overallBefore: before.overall,
          overallAfter: after.overall,
          gradeBefore: before.grade,
          gradeAfter: after.grade,
          cost,
          gain,
        }
      }
    }
  }
  // A two-point nudge that changes nothing anyone would notice is not advice.
  // Offer a fix only when it lifts the grade or buys real points; a palette
  // that needs more than one change deserves to be told so.
  if (!best) return null
  const worthIt = best.gradeAfter !== best.gradeBefore || best.gain >= 4
  if (!worthIt) return null
  const { cost: _c, gain: _g, ...fix } = best
  return fix
}
