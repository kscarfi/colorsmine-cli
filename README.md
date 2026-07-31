<div align="center">

# colorsmine

**Fail your build when your color palette isn't accessible.**

[![npm](https://img.shields.io/npm/v/colorsmine?color=8b5cf6&label=npm)](https://www.npmjs.com/package/colorsmine)
[![CI](https://github.com/kscarfi/colorsmine-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/kscarfi/colorsmine-cli/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/colorsmine?color=8b5cf6)](./LICENSE)
[![node](https://img.shields.io/node/v/colorsmine?color=8b5cf6)](https://nodejs.org)

</div>

Every other color tool is a website you visit when you remember to. This one
reads the tokens already in your repo, grades them against WCAG 2.2, APCA and
the three dichromacies, and **exits non-zero** when they don't hold up.

```bash
npx colorsmine check
```

```
ColorsMine — palette check
  src/globals.css

  █████████ █████████ █████████ █████████

    surface, card  --background        #FFFFFF
    muted          --muted-foreground  #9DA8B8
    primary        --primary           #2563EB
    text           --foreground        #020817

  Grade  A 86/100  Ship it — this palette does real work.
  Dark   A 80/100  (from your .dark block)

  Pairings
    ✓ Body text on surface     20.01:1   need 4.5  Lc 105
    ✗ Muted text on surface    2.41:1    need 4.5  Lc 45   FAIL
    ✓ Button label on primary  5.17:1    need 4.5  Lc 78
    ✓ Primary against surface  5.17:1    need 3    Lc 72

  One change away
    ▌#9DA8B8 → ▌#687281   darker — lightness 73% → 55%
    A 86 → S 94

  FAIL 1 pairing below the WCAG minimum: Muted text on surface
```

That's shadcn/ui's default theme, unmodified. Its `--muted-foreground` sits at
2.41:1 on white — well under the 4.5:1 body-text minimum, and invisible to
every tool that only shows you swatches.

---

## Why this exists

The European Accessibility Act has been in force since 28 June 2025, with no
transition period for anything launched after that date. Accessibility stopped
being a design opinion and became a build requirement — but the tooling never
moved. Contrast checkers still ask you to paste two hex codes into a web page,
by hand, after the fact.

A palette is data in your repository. It belongs in CI, next to your tests.

## Install

Nothing to install — `npx` is enough:

```bash
npx colorsmine check
```

Or add it to the project:

```bash
npm i -D colorsmine
```

## What it reads

No configuration. With no arguments it finds the files your project already
has:

| Format | Looks like |
|---|---|
| CSS custom properties | `:root { --primary: #2563eb }` |
| Tailwind v4 `@theme` | `--color-brand: oklch(0.55 0.19 262)` |
| shadcn/ui bare HSL | `--background: 0 0% 100%` |
| Declared dark themes | `.dark { … }`, `[data-theme="dark"] { … }` |
| DTCG design tokens | `{ "$type": "color", "$value": "#2563eb" }` |
| Tailwind config | `tailwind.config.{js,cjs,mjs,ts}` |
| Nested or flat JSON | `{ "colors": { "blue": { "500": "#3b82f6" } } }` |

Searched paths include `tokens.json`, `design-tokens.json`,
`tailwind.config.*`, `src/globals.css`, `app/globals.css` and
`styles/globals.css`. Or point it anywhere:

```bash
npx colorsmine check design/tokens.json src/theme.css
```

Hex, `rgb()`, `hsl()`, `oklch()` and CSS keywords are all understood.
Out-of-sRGB `oklch()` is chroma-clamped rather than channel-clipped, so a
wide-gamut blue doesn't shift hue on the way in. Translucent tokens are
skipped — what a color sits on decides its contrast, and the file doesn't say.

## Which colors get graded

A token file can hold four colors or four hundred, and grading all of them
answers nothing. The CLI looks for the semantic names every convention
converges on — `background`, `card`, `muted-foreground`, `primary`,
`foreground` — and grades the handful a screen is actually built from.

It knows the difference between a fill and the text on it: `--muted` is a
light background, `--muted-foreground` is the grey text, and grading the
former as the latter produces a meaningless 1.1:1 "failure". It also won't
seat a near-white named `--accent` in the accent slot, because a color you
can't see against the surface isn't accenting anything.

Where semantic names are absent it falls back to the most separated colors in
the file, **and says so**. Whatever it picks is printed next to the token it
came from and the job the engine gave it — a grade you can't trace back to a
line in your own repo is a number to argue with, not a result to act on.

## Options

```
--min <grade>    Minimum grade to pass: S, A, B, C or D   (default: B)
--wcag           Fail if any intended pairing misses its WCAG minimum,
                 whatever the grade says
--dark           Apply --min and --wcag to dark mode too
--colors <list>  Grade these colors instead of reading files
--json           Machine-readable output
--badge          Print the README badge markdown
--no-color       Disable ANSI color
-h, --help       Show usage
-v, --version    Print the version
```

**`--min` and `--wcag` answer different questions.** The grade is a weighted
composite in which contrast is 34%, so a palette can clear `--min B` while one
pairing still sits under AA — shadcn/ui's default theme does exactly that at
A 86. `--min` asks *is this palette any good*; `--wcag` asks *does it comply*.
For a compliance gate, use both:

```bash
npx colorsmine check --min B --wcag --dark
```

Exit codes: `0` passes · `1` fails the gate · `2` nothing could be read.

Colors can be graded directly, in any notation:

```bash
npx colorsmine check --colors "#fff, oklch(0.55 0.19 262), rgb(17, 24, 39)"
```

## GitHub Action

```yaml
name: Palette
on: [push, pull_request]

jobs:
  palette:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: kscarfi/colorsmine-cli@v1
        with:
          files: src/globals.css
          min: B
          wcag: 'true'
          dark: 'true'
```

The step writes a grade table to the job summary, emits an error annotation
for each failing gate, and exposes six outputs:

| Output | Example |
|---|---|
| `passed` | `false` |
| `grade` / `score` | `A` / `86` |
| `dark-grade` / `dark-score` | `A` / `80` |
| `badge` | `https://colorsmine.com/badge/…svg` |

Use them to gate a deploy, comment on a PR, or publish the badge:

```yaml
- uses: kscarfi/colorsmine-cli@v1
  id: palette
- run: echo "Palette scored ${{ steps.palette.outputs.grade }}"
```

### Reporting instead of blocking

Outputs are published whether the gate passes or not, so a failing palette can
still be reported. What `fail-on-error: false` changes is the step's own
result: the check stays green and the verdict moves into `passed`, for
workflows that want to comment a grade rather than block a merge.

```yaml
- uses: kscarfi/colorsmine-cli@v1
  id: palette
  with:
    min: B
    fail-on-error: 'false'
- if: steps.palette.outputs.passed == 'false'
  run: echo "Palette slipped to ${{ steps.palette.outputs.grade }}"
```

Inputs: `files`, `colors`, `min`, `wcag`, `dark`, `version`, `fail-on-error`.

## Badge

```bash
npx colorsmine check --badge
```

```markdown
[![Palette score](https://colorsmine.com/badge/ffffff-9da8b8-2563eb-020817.svg)](https://colorsmine.com/rate/ffffff-9da8b8-2563eb-020817)
```

The badge is generated on demand from the hexes in the URL and cached
immutably, so it costs nothing to embed and never goes stale.

## How the grade works

Five weighted parts:

| Part | Weight | Measures |
|---|---|---|
| Contrast | 0.34 | Share of intended pairings that pass their own requirement |
| Color-blind safety | 0.20 | Worst case across deuteranopia, protanopia, tritanopia |
| Harmony | 0.20 | Hue relations — complementary, triadic, analogous |
| Distinctness | 0.13 | Perceptual separation in OKLab |
| Tonal range | 0.13 | Light-to-dark span |

Body text is held to **4.5:1** and UI components and non-text contrast to
**3:1**, per WCAG 2.2 §1.4.11, with **APCA Lc** reported alongside each pair.
Greyscale survival is checked separately.

Grades: **S** ≥ 90 · **A** ≥ 75 · **B** ≥ 60 · **C** ≥ 45 · **D** below.

### Dark mode

If your CSS declares a real dark theme, that theme is read, merged over the
light set the way the cascade would, and graded on its own. Only when no dark
theme exists does the engine fall back to modelling one by flipping the roles
onto the same colors. The report tells you which of the two you're looking at,
because they are not the same claim.

### Determinism

The same colors always produce the same score. No sampling, no model, no
network. That's what makes a grade usable as a build condition — and what
lets `suggestFix` search the whole lightness space to find the *smallest*
single change that lifts the grade, rather than guessing at one.

## Relationship to colorsmine.com

The scoring engine is the same code that runs on
[colorsmine.com/rate](https://colorsmine.com/rate). It is bundled into this
package rather than reimplemented, so a score in CI and a score on the website
can never disagree.

`src/engine/` is vendored from the ColorsMine app repository by a sync script
and carries a header saying so. Don't edit it here — the whole promise of this
package is that there is one implementation, not two.

## Contributing

```bash
npm install
npm test
npm run build
node dist/colorsmine.mjs check --colors "#fff #6b7280 #2563eb #111827"
```

Bug reports are most useful with the token file that produced the wrong
result, or `--json` output. Issues that start "it picked the wrong colors"
are the ones worth filing — selection is the part that has to be right or
nothing downstream is.

---

MIT · built for [ColorsMine](https://colorsmine.com)
