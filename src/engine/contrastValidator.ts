// ⚠️  Vendored from the ColorsMine app — do not edit here.
// Source: src/lib/contrastValidator.ts · sync: `node scripts/sync-engine.mjs <path>`
// Editing this copy makes the CLI grade differently from colorsmine.com,
// which is the one thing this package promises cannot happen.

import { formatHex, oklch, parse, rgb } from 'culori'
import { getContrast } from 'color2k'
import type { ContrastResult, RoleMap } from './types'

export function wcagLevel(ratio: number): ContrastResult['level'] {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA Large'
  return 'Fail'
}

export function wcagLevelForContext(ratio: number, context: 'body' | 'large'): ContrastResult['level'] {
  if (context === 'large') {
    if (ratio >= 4.5) return 'AAA'
    if (ratio >= 3) return 'AA'
    return 'Fail'
  }
  return wcagLevel(ratio)
}

export function checkContrast(fg: string, bg: string): ContrastResult {
  let ratio = 1
  try { ratio = getContrast(fg, bg) } catch { ratio = 1 }
  return { ratio: Math.round(ratio * 10) / 10, level: wcagLevel(ratio) }
}

// ── APCA (WCAG 3 Working Draft) ──────────────────────────────────────────────

function sRGBtoY(c: number): number {
  const cs = c / 255
  return cs <= 0.04045 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4
}

function relativeLuminanceRgb(r: number, g: number, b: number): number {
  return 0.2126729 * sRGBtoY(r) + 0.7151522 * sRGBtoY(g) + 0.0721750 * sRGBtoY(b)
}

function hexToRgb255(hex: string): [number, number, number] | null {
  const parsed = parse(hex)
  if (!parsed) return null
  const r = rgb(parsed)
  if (!r) return null
  return [Math.round((r.r ?? 0) * 255), Math.round((r.g ?? 0) * 255), Math.round((r.b ?? 0) * 255)]
}

// Returns signed Lc value. Positive = dark text on light bg, negative = light on dark.
// Absolute value is what matters for thresholds.
export function apcaContrast(fg: string, bg: string): number {
  const fgRgb = hexToRgb255(fg)
  const bgRgb = hexToRgb255(bg)
  if (!fgRgb || !bgRgb) return 0

  const Ys = relativeLuminanceRgb(...fgRgb) // text (source)
  const Yt = relativeLuminanceRgb(...bgRgb) // background

  // Soft clamp for very dark colors
  const Ysc = Ys > 0.022 ? Ys : Ys + (0.022 - Ys) ** 1.414
  const Ytc = Yt > 0.022 ? Yt : Yt + (0.022 - Yt) ** 1.414

  const Sapc = Ytc >= Ysc
    ? (Ytc ** 0.56 - Ysc ** 0.57) * 1.14   // dark text on light bg
    : (Ytc ** 0.65 - Ysc ** 0.62) * 1.14   // light text on dark bg

  if (Math.abs(Sapc) < 0.1) return 0
  return Sapc > 0 ? (Sapc - 0.027) * 100 : (Sapc + 0.027) * 100
}

export type ApcaLevel = 'Lc75+' | 'Lc60+' | 'Lc45+' | 'Lc30+' | 'Below'

export function apcaLevel(lc: number): ApcaLevel {
  const abs = Math.abs(lc)
  if (abs >= 75) return 'Lc75+'
  if (abs >= 60) return 'Lc60+'
  if (abs >= 45) return 'Lc45+'
  if (abs >= 30) return 'Lc30+'
  return 'Below'
}

// ── Auto-fix: nearest passing shade stop ──────────────────────────────────────
// Given a role's full shade scale and a background, return the stop closest to
// 500 (least visual change) that meets the target for the chosen context.
// Turns "this pair fails" into "use primary-700 → 5.1:1 AA".
export function suggestAccessibleStop(
  scale: Record<string, string> | undefined,
  bgHex: string,
  mode: 'body' | 'large' | 'apca',
): { stop: string; hex: string; ratio: number; lc: number } | null {
  if (!scale) return null
  const safeRatio = (fg: string) => { try { return getContrast(fg, bgHex) } catch { return 1 } }
  const passes = (fg: string) =>
    mode === 'apca'
      ? Math.abs(apcaContrast(fg, bgHex)) >= 60
      : safeRatio(fg) >= (mode === 'body' ? 4.5 : 3)

  const ranked = Object.entries(scale)
    .filter(([, hex]) => passes(hex))
    .sort(([a], [b]) => Math.abs(+a - 500) - Math.abs(+b - 500))

  if (ranked.length === 0) return null
  const [stop, hex] = ranked[0]
  return {
    stop,
    hex,
    ratio: Math.round(safeRatio(hex) * 10) / 10,
    lc: Math.round(Math.abs(apcaContrast(hex, bgHex))),
  }
}

// Contrast lock: nudge the text and primary roles' lightness until they meet
// WCAG on the surface (text → 4.5:1 body, primary → 3:1 UI). Only those two
// roles are touched; hue/chroma are preserved by ensureContrast.
export function lockContrast(roleMap: RoleMap, enabled: boolean): RoleMap {
  if (!enabled || !roleMap.surface) return roleMap
  const surface = roleMap.surface.hex
  const out: RoleMap = { ...roleMap }
  if (out.text) {
    const hex = ensureContrast(out.text.hex, surface, 4.5)
    if (hex !== out.text.hex) out.text = { ...out.text, hex }
  }
  if (out.primary) {
    const hex = ensureContrast(out.primary.hex, surface, 3)
    if (hex !== out.primary.hex) out.primary = { ...out.primary, hex }
  }
  return out
}

export function ensureContrast(
  fg: string,
  bg: string,
  target: number,
  adjustFg = true
): string {
  let color = parse(fg)
  if (!color) return fg
  const bgColor = parse(bg)
  if (!bgColor) return fg

  let ratio = 1
  try { ratio = getContrast(fg, bg) } catch { ratio = 1 }
  let iterations = 0

  while (ratio < target && iterations < 20) {
    const okl = oklch(color)
    if (!okl) break
    const bgL = oklch(bgColor)?.l ?? 0.5
    okl.l = bgL > 0.5
      ? Math.max(0, (okl.l ?? 0) - 0.04)
      : Math.min(1, (okl.l ?? 0) + 0.04)
    color = okl
    const adjusted = formatHex(color)
    if (!adjusted) break
    try { ratio = getContrast(adjusted, bg) } catch { break }
    iterations++
  }

  return formatHex(color) ?? fg
}
