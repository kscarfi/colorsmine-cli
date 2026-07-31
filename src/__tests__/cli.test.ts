import { describe, expect, it } from 'vitest'
import { splitColors, toHex } from '../color'
import { readCss } from '../readers/css'
import { readJson } from '../readers/json'
import { readTailwind } from '../readers/tailwind'
import { selectPalette } from '../select'
import { readAll } from '../discover'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('toHex', () => {
  it('normalizes every notation a token file uses', () => {
    expect(toHex('#2563EB')).toBe('#2563eb')
    expect(toHex('  #fff ')).toBe('#ffffff')
    expect(toHex('rgb(37, 99, 235)')).toBe('#2563eb')
    expect(toHex('white')).toBe('#ffffff')
    expect(toHex('hsl(221.2 83.2% 53.3%)')).toBe('#2563eb')
  })

  it('reads shadcn/ui bare HSL channels', () => {
    // `--background: 0 0% 100%` is not a color to any parser, but in a token
    // file it always is one — it exists to be composed into hsl(var(--x)).
    expect(toHex('0 0% 100%')).toBe('#ffffff')
    expect(toHex('222.2 84% 4.9%')).toBe('#020817')
  })

  it('clamps out-of-sRGB oklch instead of clipping it', () => {
    // Clipping channels shifts the hue; clamping chroma keeps it. A hue shift
    // would change the grade for a reason unrelated to the palette.
    const clamped = toHex('oklch(0.55 0.4 262)')!
    const inGamut = toHex('oklch(0.55 0.19 262)')!
    expect(clamped).toMatch(/^#[0-9a-f]{6}$/)
    expect(clamped).not.toBe(inGamut)
  })

  it('refuses what cannot be graded on its own', () => {
    expect(toHex('var(--primary)')).toBeNull()
    expect(toHex('linear-gradient(#fff, #000)')).toBeNull()
    expect(toHex('rgba(0,0,0,0.5)')).toBeNull() // depends on what is behind it
    expect(toHex('1rem')).toBeNull()
    expect(toHex('Inter, sans-serif')).toBeNull()
    expect(toHex('')).toBeNull()
  })
})

describe('splitColors', () => {
  it('does not split inside functional notation', () => {
    expect(splitColors('white, oklch(0.5 0.2 260), rgb(17, 24, 39)')).toEqual([
      'white', 'oklch(0.5 0.2 260)', 'rgb(17, 24, 39)',
    ])
    expect(splitColors('#fff #000')).toEqual(['#fff', '#000'])
    expect(splitColors('#fff,#000')).toEqual(['#fff', '#000'])
  })
})

describe('readCss', () => {
  const css = `
    /* --commented: #ff0000; */
    :root {
      --radius: 0.5rem;
      --background: 0 0% 100%;
      --primary: 221.2 83.2% 53.3%;
      --font-sans: Inter, sans-serif;
    }
    .dark { --background: 222.2 84% 4.9%; }
    @theme { --color-brand: oklch(0.55 0.19 262); }
  `

  it('collects colors and ignores everything else', () => {
    const { light } = readCss(css, 'globals.css')
    const names = light.map(t => t.name)
    expect(names).toContain('--background')
    expect(names).toContain('--primary')
    expect(names).toContain('--color-brand') // Tailwind v4 @theme
    expect(names).not.toContain('--radius')
    expect(names).not.toContain('--font-sans')
    expect(names).not.toContain('--commented')
  })

  it('keeps the dark theme separate from the light one', () => {
    const { light, dark } = readCss(css, 'globals.css')
    expect(light.find(t => t.name === '--background')!.hex).toBe('#ffffff')
    expect(dark.find(t => t.name === '--background')!.hex).toBe('#020817')
  })
})

describe('readJson', () => {
  it('reads DTCG, nested and flat shapes with one walk', () => {
    const dtcg = readJson(
      '{"color":{"primary":{"$type":"color","$value":"#2563eb"}},"space":{"sm":{"$type":"dimension","$value":"4px"}}}',
      't.json',
    )
    expect(dtcg).toEqual([{ name: 'color.primary', hex: '#2563eb', source: 't.json' }])

    const nested = readJson('{"colors":{"blue":{"500":"#3b82f6"}}}', 't.json')
    expect(nested[0].name).toBe('colors.blue.500')

    const flat = readJson('{"primary":"#2563eb","radius":"0.5rem"}', 't.json')
    expect(flat.map(t => t.name)).toEqual(['primary'])
  })

  it('honours $type so a typed non-color never sneaks in', () => {
    // "tan" parses as a color, but DTCG says this token is a dimension.
    const out = readJson('{"size":{"$type":"dimension","$value":"tan"}}', 't.json')
    expect(out).toEqual([])
  })

  it('names the file when the JSON is broken', () => {
    expect(() => readJson('{oops', 'broken.json')).toThrow(/broken\.json/)
  })
})

describe('readTailwind', () => {
  it('reads a TypeScript config as text, since it cannot be imported', async () => {
    const src = `
      import type { Config } from 'tailwindcss'
      export default {
        theme: { extend: {
          colors: { surface: '#fffdf9', brand: '#b45309', ink: '#1c1917' },
          fontFamily: { sans: ['Inter'] },
        } },
      } satisfies Config
    `
    const { tokens, evaluated } = await readTailwind('tailwind.config.ts', src, 'tailwind.config.ts')
    expect(evaluated).toBe(false)
    const byLeaf = Object.fromEntries(tokens.map(t => [t.name.split('.').pop(), t.hex]))
    expect(byLeaf).toMatchObject({ surface: '#fffdf9', brand: '#b45309', ink: '#1c1917' })
    // The scan stays inside the colors block, so `sans: ['Inter']` is not a token
    expect(tokens.some(t => t.name.includes('fontFamily'))).toBe(false)
  })
})

describe('selectPalette', () => {
  const t = (name: string, hex: string) => ({ name, hex, source: 'f' })

  it('prefers the foreground variant for muted text', () => {
    // shadcn/ui: `--muted` is a light fill, `--muted-foreground` is the grey
    // text on it. Grading the fill as text produces a meaningless 1.1:1 fail.
    const sel = selectPalette([
      t('--background', '#ffffff'),
      t('--muted', '#f1f5f9'),
      t('--muted-foreground', '#9da8b8'),
      t('--primary', '#2563eb'),
      t('--foreground', '#020817'),
    ])
    expect(sel.named).toBe(true)
    const picked = Object.fromEntries(sel.picks.map(p => [p.role, p.token.name]))
    expect(picked.muted).toBe('--muted-foreground')
    expect(picked.text).toBe('--foreground')
    expect(sel.hexes).not.toContain('#f1f5f9')
  })

  it('never mistakes a label color for the body text', () => {
    // `--primary-foreground` is white text on the button, not the page's ink.
    const sel = selectPalette([
      t('--background', '#ffffff'),
      t('--primary', '#2563eb'),
      t('--primary-foreground', '#f8fafc'),
      t('--muted-foreground', '#6b7280'),
      t('--foreground', '#111827'),
    ])
    const picked = Object.fromEntries(sel.picks.map(p => [p.role, p.token.name]))
    expect(picked.text).toBe('--foreground')
    expect(picked.primary).toBe('--primary')
  })

  it('will not seat a near-white in the accent slot', () => {
    // ColorsMine's own tokens hit this: `--accent: #f5f5f5` is a hover fill,
    // not an accent. Picking it made the engine call a near-white the primary
    // and report a 1.09:1 failure against a role the file never assigned.
    const sel = selectPalette([
      t('--background', '#ffffff'),
      t('--accent', '#f5f5f5'),
      t('ui.accent', '#2563eb'),
      t('--muted-foreground', '#737373'),
      t('--foreground', '#0a0a0a'),
    ])
    expect(sel.hexes).toContain('#2563eb')
    expect(sel.hexes).not.toContain('#f5f5f5')
  })

  it('still allows surfaces to sit close together', () => {
    // Paper and card differ by a hair on purpose — the accent guard must not
    // reach them.
    const sel = selectPalette([
      t('--background', '#ffffff'),
      t('--card', '#f3f4f6'),
      t('--muted-foreground', '#6b7280'),
      t('--primary', '#2563eb'),
      t('--foreground', '#111827'),
    ])
    expect(sel.hexes).toEqual(['#ffffff', '#f3f4f6', '#6b7280', '#2563eb', '#111827'])
  })

  it('keeps the only chromatic candidate even when it is close to the surface', () => {
    // The guard narrows the field; it must never empty it.
    const sel = selectPalette([
      t('--background', '#ffffff'),
      t('--primary', '#fafafa'),
      t('--foreground', '#111111'),
    ])
    expect(sel.picks.find(p => p.role === 'primary')!.token.hex).toBe('#fafafa')
  })

  it('falls back to the most separated colors when names say nothing', () => {
    const sel = selectPalette([
      t('colors.zinc.50', '#fafafa'),
      t('colors.zinc.100', '#f4f4f5'),
      t('colors.zinc.200', '#e4e4e7'),
      t('colors.zinc.500', '#71717a'),
      t('colors.zinc.900', '#18181b'),
      t('colors.zinc.950', '#09090b'),
    ])
    expect(sel.named).toBe(false)
    expect(sel.hexes.length).toBe(5)
    // lightest and darkest are always in, and the result is ordered light→dark
    expect(sel.hexes[0]).toBe('#fafafa')
    expect(sel.hexes[sel.hexes.length - 1]).toBe('#09090b')
  })

  it('drops duplicate colors so one hex is never graded twice', () => {
    const sel = selectPalette([
      t('--background', '#ffffff'),
      t('--card', '#ffffff'), // same paper — shadcn's default
      t('--muted-foreground', '#6b7280'),
      t('--primary', '#2563eb'),
      t('--foreground', '#111827'),
    ])
    expect(new Set(sel.hexes).size).toBe(sel.hexes.length)
    expect(sel.picks.some(p => p.role === 'card')).toBe(false)
  })
})

describe('dark theme detection', () => {
  const light = ':root{--background:#fff;--muted-foreground:#6b7280;--primary:#2563eb;--foreground:#111827}'
  const darkDecls = '--background:#0a0a0a;--foreground:#fafafa;--muted-foreground:#a1a1aa'

  it('recognises the class wherever it sits in the selector', () => {
    // `html.dark` and `:root.dark` are as common as a bare `.dark`. Anchoring
    // on whitespace missed them and reported a modelled dark mode instead.
    for (const sel of ['.dark', 'html.dark', ':root.dark', 'body.dark-mode', '.theme-dark', 'html[data-theme="dark"]', '[data-mode=dark]']) {
      const { dark } = readCss(`${light}\n${sel}{${darkDecls}}`, 'g.css')
      expect(dark.find(t => t.name === '--background')?.hex, sel).toBe('#0a0a0a')
    }
  })

  it('does not mistake a longer word for the dark class', () => {
    const { dark, light: l } = readCss(`${light}\n.darkroom{--background:#0a0a0a}`, 'g.css')
    expect(dark).toHaveLength(0)
    expect(l.find(t => t.name === '--background')!.hex).toBe('#ffffff')
  })

  it('reads @media (prefers-color-scheme: dark)', () => {
    // The block matcher only sees innermost braces, so without lifting the
    // at-rule this `:root` looked like an ordinary light rule.
    const css = `${light}\n@media (prefers-color-scheme: dark){:root{${darkDecls}}}`
    const { dark, light: l } = readCss(css, 'g.css')
    expect(dark.find(t => t.name === '--background')!.hex).toBe('#0a0a0a')
    expect(l.find(t => t.name === '--background')!.hex).toBe('#ffffff')
  })

  it('survives nesting and other at-rules', () => {
    const css = `
      @layer base { ${light} }
      @supports (color: oklch(0 0 0)) {
        @media (prefers-color-scheme: dark) { :root { ${darkDecls} } }
      }
      @media (min-width: 40rem) { :root { --primary: #1d4ed8 } }
    `
    const { dark, light: l } = readCss(css, 'g.css')
    expect(dark.find(t => t.name === '--background')!.hex).toBe('#0a0a0a')
    expect(l.find(t => t.name === '--background')!.hex).toBe('#ffffff')
    // a non-dark media query stays in the light set
    expect(l.find(t => t.name === '--primary')!.hex).toBe('#2563eb')
  })

  it('keeps a light-scheme media query out of the dark set', () => {
    const css = `${light}\n@media (prefers-color-scheme: light){:root{--primary:#1d4ed8}}`
    expect(readCss(css, 'g.css').dark).toHaveLength(0)
  })
})

describe('directory arguments', () => {
  // `colorsmine check src/` is a reasonable thing to type; before this it
  // surfaced Node's raw `EISDIR` at the user.
  const root = mkdtempSync(join(tmpdir(), 'cm-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'globals.css'), ':root{--background:#fff;--foreground:#111827}')
  mkdirSync(join(root, 'empty'))

  it('looks inside a directory by file name', async () => {
    // Forward slashes on every platform — Windows reported src\\globals.css,
    // which made the JSON output depend on the OS that ran the check.
    const r = await readAll([join(root, 'src')], root)
    expect(r.files).toEqual(['src/globals.css'])
    expect(r.tokens).toHaveLength(2)
  })

  it('treats a project root like a bare check', async () => {
    const r = await readAll([root], root)
    expect(r.files).toEqual(['src/globals.css'])
  })

  it('says so when a directory holds nothing gradeable', async () => {
    const r = await readAll([join(root, 'empty')], root)
    expect(r.tokens).toHaveLength(0)
    expect(r.notes.join(' ')).toMatch(/no token file/)
  })
})
