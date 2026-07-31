import type { PaletteFix, PaletteRating, Grade } from './engine/paletteRating'
import type { Selection } from './select'

const GRADE_RGB: Record<Grade, [number, number, number]> = {
  S: [167, 139, 250], A: [52, 211, 153], B: [56, 189, 248], C: [251, 191, 36], D: [248, 113, 113],
}

export function makeStyle(enabled: boolean) {
  const wrap = (open: string, s: string) => (enabled ? `\x1b[${open}m${s}\x1b[0m` : s)
  const rgb = (hex: string) => {
    const n = hex.replace('#', '')
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
  }
  return {
    enabled,
    bold: (s: string) => wrap('1', s),
    dim: (s: string) => wrap('2', s),
    fg: (hex: string, s: string) => (enabled ? `\x1b[38;2;${rgb(hex).join(';')}m${s}\x1b[0m` : s),
    /** Solid block in the token's own color — the fastest way to see the palette. */
    swatch: (hex: string, width = 4) =>
      enabled ? `\x1b[48;2;${rgb(hex).join(';')}m${' '.repeat(width)}\x1b[0m` : hex,
    /** Same block, but next to text that already names the color. */
    chip: (hex: string, width = 2) =>
      enabled ? `\x1b[48;2;${rgb(hex).join(';')}m${' '.repeat(width)}\x1b[0m ` : '',
    grade: (g: Grade, s: string) =>
      enabled ? `\x1b[1;38;2;${GRADE_RGB[g].join(';')}m${s}\x1b[0m` : s,
    ok: (s: string) => wrap('38;2;52;211;153', s),
    bad: (s: string) => wrap('38;2;248;113;113', s),
  }
}
export type Style = ReturnType<typeof makeStyle>

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length))

/**
 * `default.theme.extend.colors.surface` carries four segments of scaffolding
 * before the part that identifies the token. Whatever every row shares tells
 * the reader nothing, so it is dropped from the display — the JSON output
 * keeps the full path, which is what a machine consumer needs.
 */
function commonPrefix(names: string[]): string {
  if (names.length < 2) return ''
  const parts = names.map(n => n.split('.'))
  let i = 0
  while (parts[0].length > i + 1 && parts.every(p => p.length > i + 1 && p[i] === parts[0][i])) i++
  return i ? parts[0].slice(0, i).join('.') + '.' : ''
}

export function render(opts: {
  rating: PaletteRating
  /** Resolved dark grade — the project's own `.dark` block when it has one. */
  dark: PaletteRating['dark'] & { declared: boolean }
  fix: PaletteFix | null
  selection: Selection
  files: string[]
  notes: string[]
  min: Grade
  passed: boolean
  reasons: string[]
  checkDark: boolean
  wcag: boolean
  s: Style
}): string {
  const { rating, dark, fix, selection, files, notes, min, passed, reasons, checkDark, wcag, s } = opts
  const out: string[] = ['']

  out.push(`${s.bold('ColorsMine')} ${s.dim('— palette check')}`)
  out.push(s.dim(`  ${files.join(', ')}`))
  out.push('')

  // The strip is the palette at a glance; the legend under it is why the grade
  // is arguable-with. A score you can't trace back to a line in your own file
  // is a number to dispute, not a result to act on — so every color is listed
  // with the token it came from and the job the engine decided it does. Token
  // names are printed in full: `--foreground` and `--muted-foreground` differ
  // only at the front, and truncating either one makes them the same word.
  out.push('  ' + selection.hexes.map(h => s.swatch(h, 9)).join(' '))
  out.push('')

  const roleOf = new Map<string, string[]>()
  for (const [role, hex] of Object.entries(rating.roles)) {
    if (typeof hex !== 'string') continue
    const key = hex.toLowerCase()
    roleOf.set(key, [...(roleOf.get(key) ?? []), role])
  }
  const strip = commonPrefix(selection.picks.map(p => p.token.name))
  const rows = selection.picks.map(p => ({
    role: (roleOf.get(p.token.hex.toLowerCase()) ?? []).join(', ') || '—',
    token: p.token.name.slice(strip.length),
    hex: p.token.hex.toUpperCase(),
    pinned: p.pinned,
  }))
  const roleW = Math.max(...rows.map(r => r.role.length))
  const tokenW = Math.max(...rows.map(r => r.token.length))
  for (const r of rows) {
    const mark = r.pinned ? s.dim(' ·pinned') : ''
    out.push(`    ${s.bold(pad(r.role, roleW))}  ${s.dim(pad(r.token, tokenW))}  ${r.hex}${mark}`)
  }
  out.push('')

  const gradeLine = (label: string, g: Grade, score: number, extra = '') =>
    `  ${pad(label, 7)}${s.grade(g, g)} ${s.bold(`${score}/100`)}${extra ? '  ' + s.dim(extra) : ''}`

  const darkNote = [dark.declared ? 'from your .dark block' : 'roles flipped', checkDark ? 'enforced' : '']
    .filter(Boolean)
    .join(', ')
  out.push(gradeLine('Grade', rating.grade, rating.overall, rating.verdict))
  out.push(gradeLine('Dark', dark.grade, dark.overall, `(${darkNote})`))
  out.push('')

  // Every column is padded before it is styled — ANSI escapes have width in a
  // string and none on screen, so padding coloured text misaligns the table.
  const labelW = Math.max(...[...rating.pairings, ...dark.pairings].map(p => p.label.length))
  const pairingRows = (list: typeof rating.pairings) =>
    list.map(p => {
      const mark = p.passes ? s.ok('✓') : s.bad('✗')
      const ratio = pad(`${p.ratio.toFixed(2)}:1`, 9)
      const need = s.dim(pad(`need ${p.required}`, 9))
      const apca = s.dim(pad(`Lc ${Math.round(Math.abs(p.apca))}`, 7))
      const tail = p.passes ? '' : s.bad('FAIL')
      return `    ${mark} ${pad(p.label, labelW)}  ${ratio} ${need} ${apca} ${tail}`.trimEnd()
    })

  out.push('  ' + s.bold('Pairings'))
  out.push(...pairingRows(rating.pairings))
  out.push('')

  // Dark mode is where palettes quietly fail, so when it is being enforced —
  // or when it is already failing — it gets its own table rather than a number.
  if (checkDark || dark.pairings.some(p => !p.passes)) {
    out.push('  ' + s.bold(dark.declared ? 'Pairings in your dark theme' : 'Pairings in dark mode'))
    out.push(...pairingRows(dark.pairings))
    out.push('')
  }

  out.push('  ' + s.bold('Scores'))
  const partW = Math.max(...rating.parts.map(p => p.label.length))
  for (const part of rating.parts) {
    const pct = Math.round(part.score * 100)
    const bar = '█'.repeat(Math.round(part.score * 20)).padEnd(20, '·')
    const color = part.score >= 0.85 ? s.ok : part.score >= 0.55 ? ((x: string) => x) : s.bad
    out.push(`    ${pad(part.label, partW)}  ${color(bar)} ${pad(String(pct), 3)}  ${s.dim(part.detail)}`)
  }
  out.push('')

  const cvdWeak = rating.cvd.score < 0.6
  if (cvdWeak) {
    out.push(
      `  ${s.bad('!')} ${rating.cvd.worst}: colors collide for this dichromacy ` +
        s.dim(`(separability ${Math.round(rating.cvd.score * 100)}/100)`),
    )
  }
  if (!rating.greyscaleSafe) {
    out.push(`  ${s.bad('!')} greyscale: two colors sit within 0.045 lightness of each other`)
  }
  if (cvdWeak || !rating.greyscaleSafe) out.push('')

  if (fix) {
    out.push('  ' + s.bold('One change away'))
    out.push(
      `    ${s.chip(fix.from)}${fix.from.toUpperCase()} → ${s.chip(fix.to)}${fix.to.toUpperCase()}` +
        `   ${s.dim(fix.move)}`,
    )
    out.push(
      `    ${s.dim(`${fix.gradeBefore} ${fix.overallBefore} → `)}${s.grade(fix.gradeAfter, fix.gradeAfter)} ` +
        s.bold(String(fix.overallAfter)),
    )
    out.push('')
  }

  // A grade that covered three roles out of five is not the same claim as a
  // grade that covered all of them, and the headline score cannot tell them
  // apart on its own. The palette above says so quietly; this says it loudly,
  // because a partial reading scores *higher* — the pairings it never built
  // are the ones that would have failed.
  if (selection.named && selection.missing.length) {
    const roles = selection.missing.join(', ')
    out.push(`  ${s.bad('!')} ${s.bold(`no token matched ${selection.missing.length === 1 ? 'the role' : 'the roles'}: ${roles}`)}`)
    out.push(`    ${s.dim(`this grade covers ${rating.pairings.length} pairing${rating.pairings.length === 1 ? '' : 's'}; a complete palette implies more`)}`)
    if (selection.ungraded.length) {
      const shown = selection.ungraded.slice(0, 6)
      out.push(`    ${s.dim('ungraded colors in these files:')}`)
      for (const t of shown) out.push(`      ${s.chip(t.hex)}${s.dim(`${t.name}  ${t.hex.toUpperCase()}`)}`)
      if (selection.ungraded.length > shown.length) {
        out.push(`      ${s.dim(`…and ${selection.ungraded.length - shown.length} more`)}`)
      }
    }
    out.push(`    ${s.dim(`pin one with --role ${selection.missing[0]}=<token>, or put it in colorsmine.json`)}`)
    out.push('')
  }

  for (const n of notes) out.push(`  ${s.dim('note:')} ${s.dim(n)}`)
  if (!selection.named) {
    out.push(
      `  ${s.dim('note:')} ${s.dim('no semantic token names found — graded the most separated colors in the file')}`,
    )
  }
  if (notes.length || !selection.named) out.push('')

  if (passed) {
    // Contrast is 34% of a weighted score, so a palette can clear its grade
    // with a pairing still under AA. Printing a red FAIL row and then PASS
    // without explaining the gap reads as a bug in the tool.
    const missed = rating.pairings.filter(p => !p.passes).length
    if (!wcag && missed) {
      out.push(
        `  ${s.dim('note:')} ${s.dim(
          `${missed} pairing${missed > 1 ? 's' : ''} miss${missed > 1 ? '' : 'es'} WCAG but the grade still clears ${min} — ` +
            'add --wcag to fail on that',
        )}`,
      )
      out.push('')
    }
    const gate = wcag ? `${min} minimum, and every pairing passes WCAG` : `${min} minimum`
    out.push(`  ${s.ok('PASS')} ${s.dim(`meets the ${gate}${checkDark ? ', light and dark' : ''}`)}`)
  } else {
    out.push(`  ${s.bad('FAIL')} ${s.dim(reasons[0])}`)
    for (const r of reasons.slice(1)) out.push(`       ${s.dim(r)}`)
  }
  out.push('')
  return out.join('\n')
}

