import { defineConfig } from 'vite-plus/pack'

export default defineConfig({
  deps: {
    resolveDepSubpath: true,
  },
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
