import { toHex, type Token } from '../color'

/**
 * One walk covers every JSON token shape in the wild:
 *
 *   DTCG      { color: { primary: { $type: "color", $value: "#2563eb" } } }
 *   Tailwind  { colors: { blue: { 500: "#3b82f6" } } }
 *   flat      { primary: "#2563eb" }
 *
 * The rule is simply "a string that parses as a color is a color token", with
 * `$value`/`value` unwrapped so DTCG paths read `color.primary` rather than
 * `color.primary.$value`. `$type` is honoured when present — a DTCG token typed
 * as `dimension` whose value happens to parse (`"1rem"` does not, but
 * `"tan"` would) stays out.
 */
export function readJson(text: string, source: string): Token[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`${source}: not valid JSON — ${(e as Error).message}`)
  }
  const out: Token[] = []
  const seen = new Set<string>()

  const walk = (node: unknown, path: string[], typeHint?: string) => {
    if (typeof node === 'string') {
      if (typeHint && typeHint !== 'color') return
      const hex = toHex(node)
      if (!hex) return
      const name = path.join('.')
      if (seen.has(name)) return
      seen.add(name)
      out.push({ name, hex, source })
      return
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    const obj = node as Record<string, unknown>
    const type = typeof obj.$type === 'string' ? obj.$type : typeof obj.type === 'string' ? obj.type : typeHint
    const value = '$value' in obj ? obj.$value : 'value' in obj ? obj.value : undefined
    if (value !== undefined) {
      walk(value, path, type)
      return
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('$')) continue
      walk(v, [...path, k], type)
    }
  }

  walk(data, [])
  return out
}
