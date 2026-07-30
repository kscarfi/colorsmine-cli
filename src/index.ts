import { resolve } from 'node:path'
import { ratePalette, suggestFix, type Grade, type PaletteRating } from './engine/paletteRating'
import type { Token } from './color'
import { discover, readAll } from './discover'
import { selectPalette } from './select'
import { makeStyle, render } from './report'
import { splitColors, toHex } from './color'

/** The dark grade, plus whether it came from the project or from the engine. */
type DarkResult = PaletteRating['dark'] & { declared: boolean }

const VERSION = '0.1.0'
const ORDER: Grade[] = ['D', 'C', 'B', 'A', 'S']

const HELP = `
ColorsMine — fail your build when your palette isn't accessible.

  Usage
    npx colorsmine check [files...]

  Files
    Any .css (custom properties, including Tailwind v4 @theme and shadcn/ui
    globals.css), .json (DTCG, Tailwind or flat) or tailwind.config.*.
    With no arguments, common token-file locations are discovered.

  Options
    --min <grade>    Minimum grade to pass: S, A, B, C or D   (default: B)
    --wcag           Fail if any intended pairing misses its WCAG minimum,
                     whatever the grade says
    --dark           Apply --min and --wcag to dark mode too
    --colors <list>  Grade these hexes instead of reading files
    --json           Machine-readable output
    --badge          Print the README badge markdown and exit
    --no-color       Disable ANSI color
    -h, --help       Show this
    -v, --version    Print the version

  Exit codes
    0  palette meets the minimum
    1  palette is below the minimum
    2  nothing could be read

  Docs: https://colorsmine.com/rate
`

interface Args {
  cmd: string
  files: string[]
  min: Grade
  wcag: boolean
  dark: boolean
  json: boolean
  badge: boolean
  color: boolean
  colors: string[]
}

function parseArgs(argv: string[]): Args | { error: string } {
  const a: Args = {
    cmd: '', files: [], min: 'B', wcag: false, dark: false, json: false, badge: false,
    color: process.stdout.isTTY === true && !process.env.NO_COLOR, colors: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--min') {
      const v = (argv[++i] ?? '').toUpperCase()
      if (!ORDER.includes(v as Grade)) return { error: `--min expects one of S, A, B, C, D — got ${argv[i] ?? '(nothing)'}` }
      a.min = v as Grade
    } else if (arg.startsWith('--min=')) {
      const v = arg.slice(6).toUpperCase()
      if (!ORDER.includes(v as Grade)) return { error: `--min expects one of S, A, B, C, D — got ${arg.slice(6)}` }
      a.min = v as Grade
    } else if (arg === '--colors') {
      const v = argv[++i]
      if (!v) return { error: '--colors expects a list of colors' }
      a.colors = splitColors(v)
    } else if (arg === '--wcag') a.wcag = true
    else if (arg === '--dark') a.dark = true
    else if (arg === '--json') a.json = true
    else if (arg === '--badge') a.badge = true
    else if (arg === '--no-color') a.color = false
    else if (arg === '--color') a.color = true
    else if (arg === '-h' || arg === '--help') a.cmd = 'help'
    else if (arg === '-v' || arg === '--version') a.cmd = 'version'
    else if (arg.startsWith('-')) return { error: `unknown option ${arg}` }
    else if (!a.cmd) a.cmd = arg
    else a.files.push(arg)
  }
  return a
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if ('error' in parsed) {
    process.stderr.write(`colorsmine: ${parsed.error}\n\nRun \`colorsmine --help\`.\n`)
    process.exit(2)
  }
  const args = parsed

  if (args.cmd === 'help' || args.cmd === '') {
    process.stdout.write(HELP)
    process.exit(args.cmd === 'help' ? 0 : 2)
  }
  if (args.cmd === 'version') {
    process.stdout.write(`${VERSION}\n`)
    process.exit(0)
  }
  if (args.cmd !== 'check') {
    process.stderr.write(`colorsmine: unknown command "${args.cmd}" — did you mean \`check\`?\n`)
    process.exit(2)
  }

  const s = makeStyle(args.color)
  const cwd = process.cwd()

  // --colors skips the file layer entirely, which is what CI matrix jobs and
  // "is this one pairing OK" questions actually want.
  let hexes: string[]
  let selection: ReturnType<typeof selectPalette>
  let files: string[] = []
  let notes: string[] = []
  let lightTokens: Token[] = []
  let darkTokens: Token[] = []

  if (args.colors.length) {
    const bad = args.colors.filter(c => !toHex(c))
    if (bad.length) {
      process.stderr.write(`colorsmine: not a color: ${bad.join(', ')}\n`)
      process.exit(2)
    }
    hexes = args.colors.map(c => toHex(c)!)
    selection = { hexes, picks: hexes.map(h => ({ role: '—', token: { name: h, hex: h, source: '--colors' } })), named: true }
    files = ['--colors']
  } else {
    const targets = args.files.length ? args.files.map(f => resolve(cwd, f)) : discover(cwd)
    if (!targets.length) {
      process.stderr.write(
        'colorsmine: no token file found.\n\n' +
          'Pass one explicitly:\n  npx colorsmine check src/globals.css\n\n' +
          'Or grade colors directly:\n  npx colorsmine check --colors "#fff #f3f4f6 #6b7280 #2563eb #111827"\n',
      )
      process.exit(2)
    }
    const read = await readAll(targets, cwd)
    files = read.files
    notes = read.notes
    if (!read.tokens.length) {
      process.stderr.write(
        `colorsmine: no colors found in ${targets.length} file(s).\n` +
          read.notes.map(n => `  ${n}\n`).join(''),
      )
      process.exit(2)
    }
    selection = selectPalette(read.tokens)
    hexes = selection.hexes
    darkTokens = read.darkTokens
    lightTokens = read.tokens
  }

  const rating = ratePalette(hexes)
  if (!rating) {
    process.stderr.write(`colorsmine: need at least two distinct colors to grade — found ${hexes.length}.\n`)
    process.exit(2)
  }
  const fix = suggestFix(hexes)

  // `rating.dark` is the engine's model of dark mode: the same colors with the
  // roles flipped. That is the right answer when all you have is a palette —
  // but a project with a real `.dark` block has already answered the question,
  // and grading what they wrote beats grading what we assumed. Dark blocks
  // override only some properties, so the light set supplies the rest, exactly
  // as the cascade would.
  let dark: DarkResult = { ...rating.dark, declared: false }
  if (darkTokens.length) {
    const overridden = new Set(darkTokens.map(t => t.name))
    const merged = [...lightTokens.filter(t => !overridden.has(t.name)), ...darkTokens]
    const declared = ratePalette(selectPalette(merged).hexes)
    if (declared) {
      dark = { grade: declared.grade, overall: declared.overall, pairings: declared.pairings, declared: true }
    }
  }

  // The grade is a weighted composite, so a palette can clear --min B while a
  // pairing still misses AA — shadcn/ui's own default theme does exactly that
  // at A 86. --wcag is the gate that answers the compliance question directly
  // instead of through a score.
  const meets = (g: Grade) => ORDER.indexOf(g) >= ORDER.indexOf(args.min)
  const failing = rating.pairings.filter(p => !p.passes)
  const darkFailing = dark.pairings.filter(p => !p.passes)
  const reasons: string[] = []
  if (!meets(rating.grade)) reasons.push(`${rating.grade} is below the ${args.min} minimum`)
  if (args.dark && !meets(dark.grade)) reasons.push(`dark mode ${dark.grade} is below the ${args.min} minimum`)
  if (args.wcag && failing.length) {
    reasons.push(`${failing.length} pairing${failing.length > 1 ? 's' : ''} below the WCAG minimum: ${failing.map(p => p.label).join(', ')}`)
  }
  if (args.wcag && args.dark && darkFailing.length) {
    reasons.push(
      `${darkFailing.length} dark-mode pairing${darkFailing.length > 1 ? 's' : ''} below the WCAG minimum: ` +
        darkFailing.map(p => p.label).join(', '),
    )
  }
  const passed = reasons.length === 0

  if (args.badge) {
    const slug = hexes.map(h => h.slice(1)).join('-')
    process.stdout.write(
      `[![Palette score](https://colorsmine.com/badge/${slug}.svg)](https://colorsmine.com/rate/${slug})\n`,
    )
    process.exit(passed ? 0 : 1)
  }

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          version: VERSION,
          passed,
          reasons,
          min: args.min,
          enforcedWcag: args.wcag,
          enforcedDark: args.dark,
          files,
          notes,
          namedSelection: selection.named,
          // `matchedAs` is why the token was picked out of the file; `roles` is
          // what the engine then decided it does. They can disagree, and the
          // engine's reading is the one the grade is built on.
          palette: selection.picks.map(p => ({
            matchedAs: p.role, token: p.token.name, hex: p.token.hex, source: p.token.source,
          })),
          roles: rating.roles,
          grade: rating.grade,
          overall: rating.overall,
          dark: {
            grade: dark.grade,
            overall: dark.overall,
            declared: dark.declared,
            pairings: dark.pairings.map(p => ({
              label: p.label, fg: p.fg, bg: p.bg, ratio: Number(p.ratio.toFixed(2)),
              required: p.required, passes: p.passes, apca: Math.round(p.apca), kind: p.kind,
            })),
          },
          parts: rating.parts.map(p => ({ label: p.label, score: p.score, detail: p.detail })),
          pairings: rating.pairings.map(p => ({
            label: p.label, fg: p.fg, bg: p.bg, ratio: Number(p.ratio.toFixed(2)),
            required: p.required, passes: p.passes, apca: Math.round(p.apca), kind: p.kind,
          })),
          cvd: rating.cvd,
          greyscaleSafe: rating.greyscaleSafe,
          fix,
          badge: `https://colorsmine.com/badge/${hexes.map(h => h.slice(1)).join('-')}.svg`,
        },
        null,
        2,
      ) + '\n',
    )
    process.exit(passed ? 0 : 1)
  }

  process.stdout.write(
    render({ rating, dark, fix, selection, files, notes, min: args.min, passed, reasons, checkDark: args.dark, wcag: args.wcag, s }),
  )
  process.exit(passed ? 0 : 1)
}

main().catch(err => {
  process.stderr.write(`colorsmine: ${err?.message ?? err}\n`)
  process.exit(2)
})
