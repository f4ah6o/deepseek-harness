/** Detect whether Node started a Desktop Host module. @module @deepseek-ai/dsh-desktop-host/is-main-module */

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Detect whether Node started the given module, including runtimes without `import.meta.main`.
 * @param moduleUrl - the module's `import.meta.url`.
 * @param importMetaMain - the runtime's `import.meta.main`, when available.
 * @param invokedPath - the process entry path from `process.argv[1]`.
 * @returns True when Node started this module.
 */
export function isMainModule(moduleUrl: string, importMetaMain: boolean | undefined, invokedPath: string | undefined): boolean {
  if (importMetaMain !== undefined) return importMetaMain
  if (invokedPath === undefined) return false

  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(moduleUrl))
  } catch (_error) {
    // A missing or inaccessible process entry cannot designate this module.
    return false
  }
}
