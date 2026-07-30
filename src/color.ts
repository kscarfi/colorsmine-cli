import { clampChroma, formatHex, parse, oklch } from 'culori'

/** One color found in a token file, with the path it was found at. */
export interface Token {
  /** Dotted or dashed path as written in the file — `--muted-foreground`, `colors.brand.500`. */
  name: string
  hex: string
  /** File the token came from, relative to cwd. */
  source: string
}

/**
 * Token files hold colors in every notation CSS allows — hex, `rgb()`, `hsl()`,
 * `oklch()`, bare keywords. Everything downstream works in hex, so normalize
 * once here and let anything that isn't a color fall through as null.
 *
 * Out-of-sRGB `oklch()` values are clamped rather than clipped: clipping a wide
 * -gamut blue shifts its hue, and a hue shift would change the grade for a
 * reason that has nothing to do with the palette.
 */
export function toHex(value: string): string | null {
  let raw = value.trim()
  if (!raw || raw.startsWith('var(') || raw.includes('gradient')) return null
  // shadcn/ui writes bare HSL channels (`--background: 0 0% 100%`) so the value
  // can be composed into `hsl(var(--background) / <alpha>)`. On its own that
  // string is not a color to any parser, but in a token file it always is one.
  if (/^-?[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(raw)) raw = `hsl(${raw})`
  let c: any
  try {
    c = parse(raw)
  } catch {
    return null
  }
  if (!c) return null
  // A translucent token can't be graded on its own — what it sits on decides
  // its contrast, and we don't know that from the file.
  if (typeof c.alpha === 'number' && c.alpha < 1) return null
  const hex = formatHex(clampChroma(c, 'oklch'))
  return hex ? hex.toLowerCase() : null
}

/**
 * Split a color list on commas and spaces — but not the ones inside
 * `oklch(0.5 0.2 260)` or `rgb(37, 99, 235)`, which are separators to a naive
 * split and part of the value to everybody else.
 */
export function splitColors(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of input) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
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
