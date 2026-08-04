import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * src/engine/ is copied out of the ColorsMine app by the app's own
 * scripts/sync-engine.mjs. The package promises `colorsmine check` grades a
 * token set exactly as colorsmine.com does, and a copy is the easiest way to
 * break that promise quietly.
 *
 * Parity with the app is not checked here and cannot be: the app repo is
 * private and this one is public, so this CI has no way to read it. That test
 * lives in the app, where `sync-engine.mjs --check` clones this repo and
 * compares on every push.
 *
 * What is left over is the window that check cannot see — a pull request here
 * that edits src/engine/ directly, which triggers nothing over there until the
 * next app push. Hashes travel with the files and need no access, so that is
 * what this file tests.
 */

const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'engine')

interface Entry { vendored: string }
const manifest: { files: Record<string, Entry> } = JSON.parse(
  readFileSync(join(ENGINE_DIR, 'sync-manifest.json'), 'utf8'),
)
const files = Object.entries(manifest.files)

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)
/** Git may check these out with CRLF on Windows; the hashes were taken on LF. */
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

describe('vendored engine', () => {
  it('covers every file the sync writes', () => {
    expect(files.length).toBeGreaterThan(0)
    for (const [name] of files) expect(existsSync(join(ENGINE_DIR, name))).toBe(true)
  })

  it.each(files)('%s has not been hand-edited since it was synced', (name, entry) => {
    expect(
      sha(read(join(ENGINE_DIR, name))),
      `${name} differs from the copy recorded in sync-manifest.json — change it in the app repo and re-run its \`node scripts/sync-engine.mjs <path-to-this-repo>\`, don't patch it here`,
    ).toBe(entry.vendored)
  })
})
