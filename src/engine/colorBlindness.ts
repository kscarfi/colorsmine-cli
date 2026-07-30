// ⚠️  Vendored from the ColorsMine app — do not edit here.
// Source: src/lib/colorBlindness.ts · sync: `node scripts/sync-engine.mjs <path>`
// Editing this copy makes the CLI grade differently from colorsmine.com,
// which is the one thing this package promises cannot happen.

export type SimulationType = 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'achromatopsia'

export interface SimulationMeta {
  label: string
  tag: string
  prevalence: string
  missing: string
  short: string
  description: string
  affected: string
  indicator: { colors: string[]; label: string }
}

export const SIMULATIONS: Record<SimulationType, SimulationMeta> = {
  none: {
    label: 'Normal vision',
    tag: '',
    prevalence: '',
    missing: '',
    short: 'As designed',
    description: '',
    affected: '',
    indicator: { colors: [], label: '' },
  },
  deuteranopia: {
    label: 'Deuteranopia',
    tag: 'Green-blind',
    prevalence: '~6% of males, ~0.4% of females',
    missing: 'M-cones (green-sensitive)',
    short: 'Red & green indistinguishable',
    description:
      'The most common form of color vision deficiency. Without green-sensitive cones, reds and greens both appear as shades of yellow, olive, or brown. Traffic lights, form validation states, data charts with red/green encoding, and success/error UI patterns are commonly affected.',
    affected: 'Error vs. success states · Red/green data charts · Traffic light patterns',
    indicator: { colors: ['#E53E3E', '#38A169'], label: 'Red & green' },
  },
  protanopia: {
    label: 'Protanopia',
    tag: 'Red-blind',
    prevalence: '~2% of males, ~0.01% of females',
    missing: 'L-cones (red-sensitive)',
    short: 'Reds appear very dark',
    description:
      'Red-sensitive cones are absent. Saturated reds appear very dark — nearly black — making red UI elements lose visibility entirely. Reds are also confused with greens and dark browns. Danger indicators, error badges, and red-coded data can become nearly invisible.',
    affected: 'Red error states · Danger indicators · Red-coded elements',
    indicator: { colors: ['#E53E3E', '#1A202C'], label: 'Red → dark' },
  },
  tritanopia: {
    label: 'Tritanopia',
    tag: 'Blue-blind',
    prevalence: '<0.01% of the population',
    missing: 'S-cones (blue-sensitive)',
    short: 'Blues shift to green, yellows to pink',
    description:
      'The rarest type of color blindness. Blues shift toward green; yellows shift toward pink or red. Sky blues and teals become difficult to separate from greens. Warning yellows may appear reddish. Often goes undiagnosed due to its rarity.',
    affected: 'Blue UI elements · Yellow warnings · Teal/blue gradients',
    indicator: { colors: ['#3182CE', '#D69E2E'], label: 'Blue & yellow' },
  },
  achromatopsia: {
    label: 'Achromatopsia',
    tag: 'Fully color-blind',
    prevalence: '~0.003% of the population',
    missing: 'All cone types',
    short: 'No color — brightness only',
    description:
      'Complete absence of color perception. Only lightness differences remain visible. All color-coded information — status badges, category labels, charts — must also be conveyed through shape, pattern, position, or text label. Often accompanied by light sensitivity and reduced visual acuity.',
    affected: 'All color-coded information · Any hue-dependent UI',
    indicator: { colors: ['#718096', '#E2E8F0'], label: 'Grayscale only' },
  },
}

// Linearize sRGB gamma
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
// Gamma-encode back to sRGB
function toGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

// Vienot 1999 matrices for simulation in linear RGB (row-major: [R',G',B'] = M * [R,G,B])
const MATRICES: Record<string, readonly [number,number,number,number,number,number,number,number,number]> = {
  protanopia:    [0.56667,0.43333,0, 0.55833,0.44167,0, 0,0.24167,0.75833],
  deuteranopia:  [0.625,  0.375,  0, 0.70,   0.30,   0, 0,0.30,   0.70   ],
  tritanopia:    [0.95,   0.05,   0, 0,       0.43333,0.56667, 0,0.475,0.525],
}

function parseHex(hex: string): [number,number,number] | null {
  const m = hex.replace('#','').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return null
  return [parseInt(m[1],16)/255, parseInt(m[2],16)/255, parseInt(m[3],16)/255]
}

function toHex(r: number, g: number, b: number): string {
  const ch = (c: number) =>
    Math.round(Math.max(0, Math.min(1, toGamma(Math.max(0,c)))) * 255).toString(16).padStart(2,'0')
  return '#' + ch(r) + ch(g) + ch(b)
}

export function simulateColorBlindness(hex: string, type: SimulationType): string {
  if (type === 'none') return hex
  const srgb = parseHex(hex)
  if (!srgb) return hex
  const [r, g, b] = srgb.map(toLinear) as [number,number,number]

  if (type === 'achromatopsia') {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return toHex(y, y, y)
  }

  const m = MATRICES[type]
  return toHex(
    m[0]*r + m[1]*g + m[2]*b,
    m[3]*r + m[4]*g + m[5]*b,
    m[6]*r + m[7]*g + m[8]*b,
  )
}
