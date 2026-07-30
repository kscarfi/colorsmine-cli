/// <reference types="vitest/config" />
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// `--version` has to be the version that was published, not a constant someone
// remembered to bump. Read it from package.json at build time.
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

// One bundled file so `npx colorsmine` installs two small dependencies and
// nothing else, and so the grade in CI is the same code that runs on the site.
export default defineConfig({
  define: { __VERSION__: JSON.stringify(version) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node18',
    minify: false,
    ssr: true,
    lib: { entry: resolve(__dirname, 'src/index.ts'), formats: ['es'] },
    rollupOptions: {
      external: ['culori', 'color2k', ...builtinModules, ...builtinModules.map(m => `node:${m}`)],
      output: { banner: '#!/usr/bin/env node', entryFileNames: 'colorsmine.mjs' },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
})
