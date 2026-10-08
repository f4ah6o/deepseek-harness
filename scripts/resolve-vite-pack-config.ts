import { loadConfigFromFile } from 'vite-plus'
import { resolve } from 'node:path'
import type { PackUserConfig, UserConfigFnContext } from 'vite-plus/pack'

type PackConfigFactory = (options: { env?: Record<string, unknown> }, context: UserConfigFnContext) => unknown

function isPackConfigFactory(value: unknown): value is PackConfigFactory {
  return typeof value === 'function'
}

/** Resolve one existing pack factory before Vite+ receives its static `pack` configuration. */
export function resolveVitePackConfig<Factory extends PackConfigFactory>(factory: Factory): Promise<Awaited<ReturnType<Factory>>>
export function resolveVitePackConfig<Config>(config: Config): Promise<Awaited<Config>>
export async function resolveVitePackConfig(config: unknown): Promise<unknown> {
  const env = process.env.DSH_BUILD_FACE === undefined ? {} : { DSH_BUILD_FACE: process.env.DSH_BUILD_FACE }
  const context: UserConfigFnContext = {
    ci: process.env.CI !== undefined,
    watch: {
      restart: () => Promise.reject(new Error('Vite config pack factories cannot restart a build before Vite+ creates the watch handle')),
      close: () => Promise.resolve(),
    },
  }
  const resolved = isPackConfigFactory(config) ? await config({ env }, context) : await config
  const configs = Array.isArray(resolved) ? resolved : [resolved]
  for (const entry of configs) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TypeError('Vite config pack factories must resolve to one or more pack configuration objects')
    }
  }
  return resolved
}

/** Load the materialized pack configs from one Vite config for the public Pack API. */
export async function loadVitePackConfigs(configPath: string, root: string, mode = 'production'): Promise<PackUserConfig[]> {
  const loaded = await loadConfigFromFile({ command: 'build', mode }, resolve(root, configPath), root, 'silent', undefined, 'native')
  if (loaded === null) throw new Error(`Vite+ pack: failed to load Vite config ${configPath}`)
  const pack: unknown = loaded.config.pack
  const configs = Array.isArray(pack) ? pack : [pack]
  if (configs.some((config) => config === null || typeof config !== 'object' || Array.isArray(config))) {
    throw new TypeError(`Vite+ pack: ${configPath} must export one or more materialized pack config objects`)
  }
  return configs as PackUserConfig[]
}
