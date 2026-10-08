import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { isMainModule } from '../src/is-main-module.ts'

const desktopHostEntries = [new URL('../src/index.ts', import.meta.url).href, new URL('../src/cli.ts', import.meta.url).href]

describe('Desktop Host main-module detection', () => {
  it.each(desktopHostEntries)('uses import.meta.main for %s when available', (moduleUrl) => {
    expect(isMainModule(moduleUrl, true, undefined)).toBe(true)
    expect(isMainModule(moduleUrl, false, fileURLToPath(moduleUrl))).toBe(false)
  })

  it.each(desktopHostEntries)('matches the invoked path for %s when import.meta.main is unavailable', (moduleUrl) => {
    expect(isMainModule(moduleUrl, undefined, fileURLToPath(moduleUrl))).toBe(true)
    expect(isMainModule(moduleUrl, undefined, process.argv[1])).toBe(false)
    expect(isMainModule(moduleUrl, undefined, undefined)).toBe(false)
    expect(isMainModule(moduleUrl, undefined, 'missing-desktop-host-entry.js')).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('recognizes a symlink to either public entry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-entry-'))
    try {
      for (const [index, moduleUrl] of desktopHostEntries.entries()) {
        const symlink = join(directory, `entry-${String(index)}.js`)
        symlinkSync(fileURLToPath(moduleUrl), symlink)
        expect(isMainModule(moduleUrl, undefined, symlink)).toBe(true)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
