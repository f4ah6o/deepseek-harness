import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { lazyPlugins } from 'vite-plus'
import type { UserConfig } from 'vite-plus/pack'

type TypertPluginFactory = typeof import('../packages/typert/generator/src/tsdown-plugin.ts').typertPlugin

function isTypertPluginModule(value: unknown): value is { typertPlugin: TypertPluginFactory } {
  return typeof value === 'object' && value !== null && 'typertPlugin' in value && typeof value.typertPlugin === 'function'
}

function isClientFace(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  const received = typeof value === 'string' ? value : JSON.stringify(value)
  throw new Error(`Vite+ pack: --env.DSH_BUILD_FACE must be host or client, received ${received}`)
}

/** Root workspace pack factory; called by the Vite+ public API with a selected build face. */
export function rootPackConfig({ env }: { env?: Record<string, unknown> }): UserConfig {
  const client = isClientFace(env?.DSH_BUILD_FACE)
  return {
    deps: { resolveDepSubpath: true },
    workspace: client ? ['vendor/*', 'packages/*/*', 'apps/cli'] : ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/desktop-host'],
    entry: client ? '' : ['lib/types/{index,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client
      ? []
      : lazyPlugins(async () => {
          const pluginPath = pathToFileURL(resolve(process.cwd(), 'packages/typert/generator/lib/types/tsdown-plugin.js')).href
          const loaded: unknown = await import(pluginPath)
          if (!isTypertPluginModule(loaded)) throw new TypeError('Typert pack module must export typertPlugin')
          return [loaded.typertPlugin({ mode: 'workspace', faces: ['host'] })]
        }),
  }
}
