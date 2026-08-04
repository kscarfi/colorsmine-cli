import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * src/engine/ is copied out of the ColorsMine app. The package promises that
 * `colorsmine check` grades a token set exactly as colorsmine.com does, and a
 * copy is the easiest way to break that promise quietly — nothing about a
 * stale or hand-edited file looks wrong when you read it.
 *
 * Two different failures, so two different tests:
 *
 *   1. Someone edits a vendored file here. Caught anywhere, including CI,
 *      by comparing against the hash recorded at sync time.
 *   2. The app's engine moves and nobody re-synced. Only detectable with the
 *      app repo on disk, so that test skips when it isn't there rather than
 *      pretending the check ran.
 *
 * Both compare whole-file hashes the sync script recorded. An earlier version
 * imported the script's transform helpers to recompute them, which meant this
 * file reached across the vite root into a .mjs — fine on macOS and Linux,
 * a load-time SyntaxError on Windows, where the externalised absolute path
 * is not a valid ESM specifier. Hashes need no transform and no import.
 */

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENGINE_DIR = join(CLI_ROOT, 'src', 'engine')

interface Entry { source: string; upstream: string; vendored: string }
const manifest: { files: Record<string, Entry> } = JSON.parse(
  readFileSync(join(ENGINE_DIR, 'sync-manifest.json'), 'utf8'),
)
const files = Object.entries(manifest.files)

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** Git may check these out with CRLF on Windows; the hashes were taken on LF. */
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

function findApp(): string | null {
  const candidates = [
    process.env.COLORSMINE_APP,
    join(CLI_ROOT, '..', 'ColorsMine'),
    join(homedir(), 'Desktop', 'ColorsMine'),
  ].filter(Boolean) as string[]
  for (const c of candidates) if (existsSync(join(c, 'src', 'lib', 'paletteRating.ts'))) return resolve(c)
  return null
}

describe('vendored engine', () => {
  it('covers every file the sync script owns', () => {
    expect(files.length).toBeGreaterThan(0)
    for (const [name] of files) expect(existsSync(join(ENGINE_DIR, name))).toBe(true)
  })

  it.each(files)('%s has not been hand-edited since it was synced', (name, entry) => {
    expect(
      sha(read(join(ENGINE_DIR, name))),
      `${name} differs from the copy recorded in sync-manifest.json — edit it in the app repo and re-run \`node scripts/sync-engine.mjs\`, don't patch it here`,
    ).toBe(entry.vendored)
  })

  const app = findApp()
  const withApp = app ? describe : describe.skip

  withApp('against the app repo', () => {
    it.each(files)('%s matches the app source', (_name, entry) => {
      expect(
        sha(read(join(app!, entry.source))),
        `${entry.source} has moved on — run \`node scripts/sync-engine.mjs\``,
      ).toBe(entry.upstream)
    })
  })
})
