import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { isMainModule } from '../src/is-main-module.ts'

const cliModuleUrl = new URL('../src/bin.ts', import.meta.url).href
const cliModulePath = fileURLToPath(cliModuleUrl)

describe('CLI main-module detection', () => {
  it('uses import.meta.main when the runtime provides it', () => {
    expect(isMainModule(cliModuleUrl, true, undefined)).toBe(true)
    expect(isMainModule(cliModuleUrl, false, cliModulePath)).toBe(false)
  })

  it('falls back to the process entry path when import.meta.main is unavailable', () => {
    expect(isMainModule(cliModuleUrl, undefined, cliModulePath)).toBe(true)
    expect(isMainModule(cliModuleUrl, undefined, process.argv[1])).toBe(false)
    expect(isMainModule(cliModuleUrl, undefined, undefined)).toBe(false)
    expect(isMainModule(cliModuleUrl, undefined, 'missing-dsh-entry.ts')).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('recognizes an installed symlink to the CLI entry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-entry-'))
    try {
      const symlink = join(directory, 'dsh')
      symlinkSync(cliModulePath, symlink)
      expect(isMainModule(cliModuleUrl, undefined, symlink)).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
