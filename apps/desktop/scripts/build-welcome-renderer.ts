/** Bundle the isolated Welcome renderer and its local font assets. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite-plus'

/**
 * Build the standalone React entry used by the native Welcome window.
 * @param outputDirectory - Output directory, relative to apps/desktop or absolute.
 * @returns completion after the renderer, styles, and font assets are written.
 */
export async function buildWelcomeRenderer(outputDirectory = 'lib/welcome'): Promise<void> {
  await build({
    configFile: false,
    plugins: [
      {
        name: 'desktop-brand-font',
        async generateBundle() {
          for (const name of [
            'brand-font.css',
            'montserrat-regular.woff2',
            'montserrat-light.woff2',
            'montserrat-medium.woff2',
            'Montserrat-OFL.txt',
          ]) {
            this.emitFile({
              type: 'asset',
              fileName: name,
              source: await readFile(new URL(`../../../packages/client/ui-theme/src/styles/${name}`, import.meta.url)),
            })
          }
        },
      },
    ],
    root: fileURLToPath(new URL('../', import.meta.url)),
    oxc: { jsx: { runtime: 'automatic', development: false } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      lib: {
        entry: 'src/client/welcome.tsx',
        formats: ['iife'],
        name: 'DesktopWelcome',
        fileName: () => 'welcome.js',
        cssFileName: 'welcome',
      },
    },
  })
}
