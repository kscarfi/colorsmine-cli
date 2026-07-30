// ⚠️  Vendored from the ColorsMine app — do not edit here.
// Source: src/lib/colorNaming.ts · sync: `node scripts/sync-engine.mjs <path>`
// Editing this copy makes the CLI grade differently from colorsmine.com,
// which is the one thing this package promises cannot happen.

import { hsl as toHsl, oklab, oklch, parse, rgb as toRgb } from 'culori'
import { getContrast } from 'color2k'
import type { CatalogPalette } from './types'

/**
 * Deterministic color naming, descriptions and palette "meaning" tags.
 * No AI, no backend: names come from a curated table via OKLab ΔE, prose is
 * assembled from hue/lightness/chroma buckets with a seeded pick, so the same
 * color always tells the same story — on every device, offline.
 */

// ── curated named colors (hex → name), spread across the wheel ──────────────
const NAMED_COLORS: [string, string][] = [
  // neutrals
  ['#ffffff', 'White'], ['#f8f6f2', 'Ivory'], ['#f5f0e6', 'Cream'], ['#ede4d3', 'Parchment'],
  ['#e3dacd', 'Bone'], ['#d6cfc4', 'Oat'], ['#c0b8ac', 'Stone'], ['#a89f92', 'Taupe'],
  ['#8a8378', 'Driftwood'], ['#6e6a63', 'Pewter'], ['#54504a', 'Charcoal Brown'],
  ['#d9d9d9', 'Silver'], ['#b3b3b3', 'Ash'], ['#8c8c8c', 'Gray'], ['#666666', 'Graphite'],
  ['#404040', 'Charcoal'], ['#262626', 'Onyx'], ['#111111', 'Ink'], ['#000000', 'Black'],
  // reds
  ['#7a1f2b', 'Oxblood'], ['#9b1c31', 'Garnet'], ['#c0392b', 'Brick'], ['#d62839', 'Crimson'],
  ['#e63946', 'Poppy'], ['#ef4444', 'Scarlet'], ['#f87171', 'Watermelon'], ['#fca5a5', 'Rose Quartz'],
  ['#ffdad7', 'Shell Pink'],
  // oranges / corals
  ['#7c2d12', 'Rust'], ['#9a3412', 'Burnt Sienna'], ['#c2410c', 'Terracotta'], ['#ea580c', 'Pumpkin'],
  ['#f97316', 'Tangerine'], ['#fb923c', 'Apricot'], ['#fdba74', 'Cantaloupe'], ['#ffd9b3', 'Peach Cream'],
  ['#e76f51', 'Coral Clay'], ['#ff7f6a', 'Salmon'], ['#ffa494', 'Melon'],
  // browns
  ['#3f2a1e', 'Espresso'], ['#5c4033', 'Cocoa'], ['#6f4e37', 'Coffee'], ['#8b6f47', 'Walnut'],
  ['#a98467', 'Caramel'], ['#c8a27a', 'Camel'], ['#d9b98d', 'Sand'], ['#e8d3ae', 'Wheat'],
  // yellows / golds
  ['#713f12', 'Bronze'], ['#a16207', 'Ochre'], ['#ca8a04', 'Mustard'], ['#d4af37', 'Gold'],
  ['#eab308', 'Saffron'], ['#facc15', 'Sunflower'], ['#fde047', 'Lemon'], ['#fef08a', 'Butter'],
  ['#fdf6c9', 'Custard'], ['#e3c565', 'Honey'],
  // yellow-greens / olives
  ['#3f4a1f', 'Deep Olive'], ['#556b2f', 'Olive'], ['#6b8e23', 'Olive Leaf'], ['#8a9a5b', 'Moss'],
  ['#a3b18a', 'Sage'], ['#c2cc9a', 'Pistachio'], ['#d9e4c0', 'Celadon Mist'],
  ['#84cc16', 'Lime'], ['#a3e635', 'Chartreuse'],
  // greens
  ['#14342b', 'Deep Forest'], ['#1b4332', 'Forest'], ['#2d6a4f', 'Pine'], ['#40916c', 'Fern'],
  ['#16a34a', 'Kelly Green'], ['#22c55e', 'Clover'], ['#52b788', 'Jade'], ['#74c69d', 'Mint Leaf'],
  ['#a7f3d0', 'Mint'], ['#d8f3dc', 'Honeydew'],
  // teals / cyans
  ['#0b3c49', 'Deep Teal'], ['#0f766e', 'Teal'], ['#14b8a6', 'Turquoise'], ['#2dd4bf', 'Aqua'],
  ['#5eead4', 'Lagoon'], ['#99f6e4', 'Sea Foam'], ['#155e75', 'Peacock'], ['#0891b2', 'Cerulean'],
  ['#06b6d4', 'Cyan'], ['#67e8f9', 'Ice Blue'],
  // blues
  ['#12233d', 'Midnight'], ['#1e3a5f', 'Navy'], ['#1d4ed8', 'Cobalt'], ['#2563eb', 'Royal Blue'],
  ['#3b82f6', 'Azure'], ['#60a5fa', 'Cornflower'], ['#93c5fd', 'Sky'], ['#bfdbfe', 'Powder Blue'],
  ['#dbeafe', 'Frost'], ['#4c6ef5', 'Sapphire'], ['#5c7cfa', 'Periwinkle'],
  // indigos / violets
  ['#231942', 'Deep Indigo'], ['#3730a3', 'Indigo'], ['#4f46e5', 'Iris'], ['#6366f1', 'Cornflower Indigo'],
  ['#818cf8', 'Lavender Blue'], ['#c7d2fe', 'Lilac Frost'],
  ['#4a1d6a', 'Royal Purple'], ['#6b21a8', 'Plum'], ['#7c3aed', 'Violet'], ['#8b5cf6', 'Amethyst'],
  ['#a78bfa', 'Wisteria'], ['#c4b5fd', 'Lavender'], ['#e9d5ff', 'Thistle'],
  // magentas / pinks
  ['#701a45', 'Mulberry'], ['#9d174d', 'Raspberry'], ['#be185d', 'Magenta Rose'], ['#db2777', 'Fuchsia'],
  ['#ec4899', 'Hot Pink'], ['#f472b6', 'Bubblegum'], ['#f9a8d4', 'Carnation'], ['#fce7f3', 'Blush'],
  ['#c026d3', 'Orchid'], ['#e879f9', 'Pink Orchid'],
  // roses
  ['#881337', 'Wine'], ['#be123c', 'Ruby'], ['#e11d48', 'Rose Red'], ['#fb7185', 'Rose'],
  ['#fda4af', 'Ballet Pink'], ['#ffe4e6', 'Rose Water'],
  // dusty / muted accents
  ['#b08999', 'Dusty Rose'], ['#9a8c98', 'Heather'], ['#7d8ca3', 'Slate Blue'], ['#64748b', 'Slate'],
  ['#8e9aaf', 'Blue Fog'], ['#b8a1c7', 'Mauve'], ['#c9ada7', 'Rosewood Mist'], ['#997b66', 'Mocha'],
  ['#7f9183', 'Eucalyptus'], ['#6d8a96', 'Storm Blue'],
]

let namedLabs: { name: string; lab: [number, number, number] }[] | null = null
function getNamedLabs() {
  if (namedLabs) return namedLabs
  namedLabs = NAMED_COLORS.map(([hex, name]) => {
    const m = oklab(parse(hex)!)
    return { name, lab: [m?.l ?? 0, m?.a ?? 0, m?.b ?? 0] as [number, number, number] }
  })
  return namedLabs
}

/** Nearest curated color name for any hex — deterministic, ΔE in OKLab. */
export function nearestColorName(hex: string): string {
  const p = parse(hex)
  const m = p ? oklab(p) : null
  if (!m) return 'Color'
  const lab: [number, number, number] = [m.l ?? 0, m.a ?? 0, m.b ?? 0]
  let best = 'Color', bestD = Infinity
  for (const n of getNamedLabs()) {
    const d = (n.lab[0] - lab[0]) ** 2 + (n.lab[1] - lab[1]) ** 2 + (n.lab[2] - lab[2]) ** 2
    if (d < bestD) { bestD = d; best = n.name }
  }
  return best
}

// ── deterministic pick (FNV-1a over a string) ────────────────────────────────
function hashPick<T>(seedStr: string, arr: T[]): T {
  let h = 0x811c9dc5
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return arr[(h >>> 0) % arr.length]
}

// ── per-color one-liners from L/C/H buckets ──────────────────────────────────
const HUE_WORDS: { max: number; noun: string; scene: string[] }[] = [
  { max: 20,  noun: 'red',       scene: ['late-summer berries', 'a theater curtain', 'embers at dusk'] },
  { max: 50,  noun: 'orange',    scene: ['sun-warmed clay', 'autumn markets', 'toasted spice'] },
  { max: 90,  noun: 'gold',      scene: ['afternoon light on wheat', 'old brass', 'honey in a jar'] },
  { max: 150, noun: 'green',     scene: ['new leaves after rain', 'a quiet forest floor', 'fresh herbs'] },
  { max: 200, noun: 'teal',      scene: ['shallow lagoons', 'sea glass', 'glacier melt'] },
  { max: 260, noun: 'blue',      scene: ['open sky before noon', 'deep harbor water', 'a favorite pair of jeans'] },
  { max: 315, noun: 'violet',    scene: ['twilight just after sunset', 'wild irises', 'a velvet chair'] },
  { max: 345, noun: 'pink',      scene: ['peonies in June', 'neon signs at night', 'a candy shop window'] },
  { max: 360, noun: 'rose',      scene: ['pressed rose petals', 'a warm blush', 'strawberry cream'] },
]

export function describeColor(hex: string): string {
  const p = parse(hex)
  const o = p ? oklch(p) : null
  if (!o) return ''
  const l = o.l ?? 0.5, c = o.c ?? 0, h = ((o.h ?? 0) % 360 + 360) % 360
  if (c < 0.02) {
    const tone = l > 0.85 ? ['a clean, paper-quiet neutral', 'bright and airy, almost weightless']
      : l > 0.55 ? ['a calm mid-gray that lets other colors speak', 'soft and architectural']
      : ['a grounded near-black with real depth', 'quiet, heavy and certain']
    return hashPick(hex, tone) + '.'
  }
  const band = HUE_WORDS.find(b => h <= b.max) ?? HUE_WORDS[0]
  const light = l > 0.82 ? 'A whisper-light' : l > 0.6 ? 'A luminous' : l > 0.4 ? 'A full-bodied' : 'A deep, shadowed'
  const sat = c > 0.16 ? 'vivid' : c > 0.08 ? 'balanced' : 'dusty'
  return `${light}, ${sat} ${band.noun} — the color of ${hashPick(hex, band.scene)}.`
}

// ── palette contrast summary (for the detail dialog / palette pages) ────────
export interface ContrastSummary {
  aa: number
  total: number
  /** strongest pairs, darker color as fg on the lighter bg */
  best: { fg: string; bg: string; ratio: number }[]
}

export function contrastSummary(colors: string[]): ContrastSummary {
  const pairs: { fg: string; bg: string; ratio: number }[] = []
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const ratio = getContrast(colors[i], colors[j])
      const li = oklch(parse(colors[i])!)?.l ?? 0.5
      const lj = oklch(parse(colors[j])!)?.l ?? 0.5
      const [fg, bg] = li < lj ? [colors[i], colors[j]] : [colors[j], colors[i]]
      pairs.push({ fg, bg, ratio })
    }
  }
  return {
    aa: pairs.filter(p => p.ratio >= 4.5).length,
    total: pairs.length,
    best: [...pairs].sort((a, b) => b.ratio - a.ratio).slice(0, 2),
  }
}

// ── copyable format strings (RGB / HSL / CMYK) ──────────────────────────────
export function colorFormats(hex: string): { label: string; value: string }[] {
  const p = parse(hex)
  if (!p) return []
  const r = toRgb(p), h = toHsl(p)
  const R = Math.round((r?.r ?? 0) * 255), G = Math.round((r?.g ?? 0) * 255), B = Math.round((r?.b ?? 0) * 255)
  const k = 1 - Math.max(R, G, B) / 255
  const cmyk = k >= 1
    ? [0, 0, 0, 100]
    : [(1 - R / 255 - k) / (1 - k), (1 - G / 255 - k) / (1 - k), (1 - B / 255 - k) / (1 - k), k].map(v => Math.round(v * 100))
  return [
    { label: 'RGB', value: `rgb(${R}, ${G}, ${B})` },
    { label: 'HSL', value: `hsl(${Math.round(((h?.h ?? 0) % 360 + 360) % 360)}, ${Math.round((h?.s ?? 0) * 100)}%, ${Math.round((h?.l ?? 0) * 100)}%)` },
    { label: 'CMYK', value: `cmyk(${cmyk[0]}%, ${cmyk[1]}%, ${cmyk[2]}%, ${cmyk[3]}%)` },
  ]
}

// ── palette meanings from measured stats ─────────────────────────────────────
export function paletteMeanings(p: CatalogPalette): string[] {
  const out: string[] = []
  const lch = p.lab.map(([l, a, b]) => ({ l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }))
  const avgL = lch.reduce((s, o) => s + o.l, 0) / lch.length
  const avgC = lch.reduce((s, o) => s + o.c, 0) / lch.length
  const maxC = Math.max(...lch.map(o => o.c))
  const has = (lo: number, hi: number, minC = 0.05) => lch.some(o => o.c >= minC && o.h >= lo && o.h <= hi)
  const warm = lch.filter(o => o.c > 0.04 && (o.h <= 70 || o.h >= 330)).length
  const cool = lch.filter(o => o.c > 0.04 && o.h >= 160 && o.h <= 280).length

  if (has(90, 160)) out.push('Nature', 'Growth')
  if (has(200, 262, 0.06)) out.push('Trust', 'Stability')
  if (has(40, 95, 0.06)) out.push('Optimism')
  if (has(300, 345, 0.07) || has(263, 299, 0.07)) out.push('Creativity')
  if (warm >= 3) out.push('Warmth', 'Comfort')
  if (cool >= 3) out.push('Calm')
  if (maxC > 0.19) out.push('Energy')
  if (avgC < 0.07) out.push('Sophistication')
  if (avgL > 0.74) out.push('Softness', 'Clarity')
  if (avgL < 0.42) out.push('Depth', 'Luxury')
  if (avgL >= 0.42 && avgL <= 0.74 && avgC >= 0.07 && avgC <= 0.13) out.push('Balance')
  if (p.tags.includes('earthy')) out.push('Grounding')
  if (out.length === 0) out.push('Harmony')
  return [...new Set(out)].slice(0, 6)
}

// ── palette description (1–2 sentences) ──────────────────────────────────────
export function describePalette(p: CatalogPalette): string {
  const sorted = p.lab
    .map(([l, a, b], i) => ({ i, c: Math.hypot(a, b) }))
    .sort((x, y) => y.c - x.c)
  const lead = nearestColorName(p.colors[sorted[0].i])
  const support = nearestColorName(p.colors[sorted[1]?.i ?? 0])
  const meanings = paletteMeanings(p)
  const mood = meanings.slice(0, 2).map(m => m.toLowerCase()).join(' and ')
  const openers = [
    `${lead} takes the lead with ${support} close behind`,
    `Built around ${lead}, softened by ${support}`,
    `${lead} and ${support} set the tone`,
    `A conversation between ${lead} and ${support}`,
  ]
  const closers = [
    ` — five colors that lean into ${mood}.`,
    `, giving this palette its sense of ${mood}.`,
    ` in a set that reads as ${mood} at first glance.`,
    ` — the whole palette hums with ${mood}.`,
  ]
  return hashPick(p.id, openers) + hashPick(p.id + '/c', closers)
}
