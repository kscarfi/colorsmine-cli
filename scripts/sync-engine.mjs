#!/usr/bin/env node
/**
 * Copy the rating engine out of the ColorsMine app into src/engine/.
 *
 * This package's whole promise is that `colorsmine check` gives a token set the
 * same grade colorsmine.com would. The engine lives in the app repo, so these
 * files are copies — and copies drift. Every vendored file carried a banner
 * naming this script long before the script existed, which meant syncing was
 * whatever the person remembered to do.
 *
 *   node scripts/sync-engine.mjs [path-to-app-repo]
 *
 * The app path defaults to ../ColorsMine, then ~/Desktop/ColorsMine.
 *
 * types.ts is deliberately not synced: it is a hand-assembled subset of the
 * app's src/types/ plus CatalogPalette, not a copy of any single file.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_DIR = join(CLI_ROOT, 'src', 'engine')
const MANIFEST = join(ENGINE_DIR, 'sync-manifest.json')

/** Vendored file → its path inside the app repo. */
const FILES = {
  'paletteRating.ts': 'src/lib/paletteRating.ts',
  'colorBlindness.ts': 'src/lib/colorBlindness.ts',
  'colorNaming.ts': 'src/lib/colorNaming.ts',
  'contrastValidator.ts': 'src/lib/contrastValidator.ts',
  'roleSelection.ts': 'src/lib/roleSelection.ts',
}

/**
 * The app spreads its types over src/types/ and src/lib/paletteCatalog.ts; the
 * CLI keeps the subset it needs in one local file. Only import specifiers are
 * rewritten — never a line of logic, or the copies would stop being copies.
 */
const IMPORT_REWRITES = [
  [/from '\.\.\/types'/g, "from './types'"],
  [/from '\.\/paletteCatalog'/g, "from './types'"],
]

const BANNER = name =>
  `// ⚠️  Vendored from the ColorsMine app — do not edit here.\n` +
  `// Source: ${FILES[name]} · sync: \`node scripts/sync-engine.mjs <path>\`\n` +
  `// Editing this copy makes the CLI grade differently from colorsmine.com,\n` +
  `// which is the one thing this package promises cannot happen.\n\n`

const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** Vendored body with the banner stripped — what the drift test compares. */
export function bodyOf(vendored) {
  return vendored.replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n)*\n/, '')
}

/** Upstream source rewritten the way it is stored here. */
export function vendoredBody(upstream) {
  return IMPORT_REWRITES.reduce((text, [from, to]) => text.replace(from, to), upstream)
}

function findAppRoot(argv) {
  const candidates = [
    argv[2],
    join(CLI_ROOT, '..', 'ColorsMine'),
    join(homedir(), 'Desktop', 'ColorsMine'),
  ].filter(Boolean)
  for (const c of candidates) if (existsSync(join(c, 'src', 'lib', 'paletteRating.ts'))) return resolve(c)
  return null
}

async function main() {
  const app = findAppRoot(process.argv)
  if (!app) {
    console.error('Could not find the app repo. Pass it:\n  node scripts/sync-engine.mjs ../ColorsMine')
    process.exit(1)
  }
  console.log(`app: ${app}\n`)

  await mkdir(ENGINE_DIR, { recursive: true })
  const manifest = { syncedFrom: app, syncedAt: new Date().toISOString(), files: {} }
  let changed = 0

  for (const [name, sourcePath] of Object.entries(FILES)) {
    const upstream = await readFile(join(app, sourcePath), 'utf8')
    const body = vendoredBody(upstream)
    const next = BANNER(name) + body
    const target = join(ENGINE_DIR, name)
    const current = existsSync(target) ? await readFile(target, 'utf8') : null

    if (current !== next) { await writeFile(target, next); changed++ }
    manifest.files[name] = { source: sourcePath, upstream: sha(upstream), vendored: sha(body) }
    console.log(`  ${current === next ? '=' : '↓'} ${name.padEnd(22)} ${sha(body)}`)
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\n${changed === 0 ? 'already in sync' : `${changed} file(s) updated`} · manifest written`)
  console.log('types.ts is hand-maintained and was not touched.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
