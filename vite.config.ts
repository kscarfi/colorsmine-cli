/// <reference types="vitest/config" />
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// One bundled file so `npx colorsmine` installs two small dependencies and
// nothing else, and so the grade in CI is the same code that runs on the site.
export default defineConfig({
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
