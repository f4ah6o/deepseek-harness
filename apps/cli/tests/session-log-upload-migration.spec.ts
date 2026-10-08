import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { execa } from 'execa'
import { parseDocument } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateSessionLogUploadDefaults } from '../src/session-log-upload-migration.ts'

vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...actual, writeFileAtomic: vi.fn((...args: Parameters<typeof actual.writeFileAtomic>) => actual.writeFileAtomic(...args)) }
})

const MIGRATION_KEY = 'f4ah6o/deepseek-harness/session-log-upload-default-off'
const childEntry = fileURLToPath(new URL('./fixtures/migrate-session-log-upload.ts', import.meta.url))
const tsxLoader = import.meta.resolve('tsx/esm')
const CHILD_TIMEOUT_MS = 30_000
const homes: string[] = []

afterEach(() => {
  vi.mocked(writeFileAtomic).mockClear()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-session-log-migration-'))
  homes.push(home)
  return home
}

function makeProfile(home: string, name: string, patch: string): string {
  const dir = join(home, 'profiles', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `profile-${name}`, private: true, dsh: { profile: { bundles: [] } },
  }) + '\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  return dir
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + CHILD_TIMEOUT_MS
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`migration synchronization file did not appear: ${path}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('preboot Session-log upload migration', () => {
  it('resets saved profile, home, and legacy opt-ins while preserving surrounding YAML', async () => {
    const home = makeHome()
    const profileDir = makeProfile(home, 'web', [
      '# profile comment',
      '- id: session-log-deepseek # entry note',
      '  config:',
      '    enabled: true # saved profile opt-in',
      '    keep: !!js "\'expression\'"',
      '- id: other',
      '  config: { enabled: true }',
      '',
    ].join('\n'))
    const homePatch = join(home, 'cordis.patch.yml')
    const legacy = join(home, 'settings.yaml')
    writeFileSync(homePatch, [
      '# home comment',
      '- id: session-log-deepseek',
      '  config:',
      '    enabled: true # saved machine opt-in',
      '    keep: value',
      '- id: other',
      '  config: { enabled: true }',
      '',
    ].join('\n'))
    writeFileSync(legacy, [
      '# legacy comment',
      'session-log-deepseek:',
      '  enabled: true # old importer value',
      '  keep: value',
      'other:',
      '  name: preserve',
      '  expression: !!js "\'legacy expression\'"',
      '',
    ].join('\n'))

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const profileText = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    expect(profileText).toContain('enabled: false # saved profile opt-in')
    expect(profileText).toContain('keep: !!js "\'expression\'"')
    expect(profileText).toContain('id: other')
    const homeText = readFileSync(homePatch, 'utf8')
    expect(homeText).toContain('home comment')
    expect(homeText).toContain('keep: value')
    expect(homeText).toContain('id: other')
    const homeDocument = parseDocument(homeText)
    expect(homeDocument.getIn([0, 'config', 'enabled'])).toBeUndefined()
    expect(homeDocument.getIn([1, 'config', 'enabled'])).toBe(true)
    expect(readFileSync(legacy, 'utf8')).toContain('enabled: false # old importer value')
    expect(readFileSync(legacy, 'utf8')).toContain('name: preserve')
    expect(readFileSync(legacy, 'utf8')).toContain('expression: !!js "\'legacy expression\'"')
    expect(JSON.parse(readFileSync(join(profileDir, '.dsh-profile-migrations.json'), 'utf8')))
      .toEqual({ [MIGRATION_KEY]: 1 })
    expect(JSON.parse(readFileSync(join(home, '.dsh-home-migrations.json'), 'utf8')))
      .toEqual({ [MIGRATION_KEY]: 1 })
  })

  it('preserves false values and absent files while recording both owners', async () => {
    const home = makeHome()
    const profileDir = makeProfile(home, 'headless', '- id: session-log-deepseek\n  config: { enabled: false }\n')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '- id: session-log-deepseek\n  config: { enabled: false }\n')

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toContain('enabled: false')
    expect(readFileSync(homePatch, 'utf8')).toContain('enabled: false')
    expect(existsSync(join(home, 'settings.yaml'))).toBe(false)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(true)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(true)
  })

  it('does not reset a later explicit profile or home opt-in', async () => {
    const home = makeHome()
    const profilePatch = join(home, 'cordis.patch.yml')
    const profileDir = makeProfile(home, 'web', '- id: session-log-deepseek\n  config: { enabled: true }\n')
    writeFileSync(profilePatch, '- id: session-log-deepseek\n  config: { enabled: true }\n')
    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, profilePatch)

    const laterProfileOptIn = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    const laterHomeOptIn = '- id: session-log-deepseek\n  config: { enabled: true, keep: value }\n'
    writeFileSync(join(profileDir, 'cordis.patch.yml'), laterProfileOptIn)
    writeFileSync(profilePatch, laterHomeOptIn)
    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, profilePatch)

    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(laterProfileOptIn)
    expect(readFileSync(profilePatch, 'utf8')).toBe(laterHomeOptIn)
  })

  it.each(['profile patch', 'home patch', 'legacy settings'] as const)('fails before committing edits when %s is malformed', async (broken) => {
    const home = makeHome()
    const profileText = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    const homeText = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    const profileDir = makeProfile(home, 'web', broken === 'profile patch' ? '- id: [\n' : profileText)
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, broken === 'home patch' ? '- id: [\n' : homeText)
    if (broken === 'legacy settings') writeFileSync(join(home, 'settings.yaml'), 'session-log-deepseek: [\n')

    await expect(migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)).rejects.toThrow(/invalid YAML/)

    expect(readFileSync(profilePatch, 'utf8')).toBe(broken === 'profile patch' ? '- id: [\n' : profileText)
    expect(readFileSync(homePatch, 'utf8')).toBe(broken === 'home patch' ? '- id: [\n' : homeText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it('fails closed and leaves migration markers absent when an atomic save fails', async () => {
    const home = makeHome()
    const profileText = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    const profileDir = makeProfile(home, 'web', profileText)
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, profileText)
    vi.mocked(writeFileAtomic).mockImplementationOnce(async () => { throw new Error('disk write failed') })

    await expect(migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)).rejects.toThrow('disk write failed')

    expect(readFileSync(profilePatch, 'utf8')).toBe(profileText)
    expect(readFileSync(homePatch, 'utf8')).toBe(profileText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it.each(['[]\n', '{"f4ah6o/deepseek-harness/session-log-upload-default-off":0}\n'])(
    'fails closed when the shared-home migration marker is invalid (%s)', async (marker) => {
      const home = makeHome()
      const profileText = '- id: session-log-deepseek\n  config: { enabled: true }\n'
      const profileDir = makeProfile(home, 'web', profileText)
      const homePatch = join(home, 'cordis.patch.yml')
      writeFileSync(homePatch, profileText)
      writeFileSync(join(home, '.dsh-home-migrations.json'), marker)

      await expect(migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch))
        .rejects.toThrow(/invalid format/)

      expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(profileText)
      expect(readFileSync(homePatch, 'utf8')).toBe(profileText)
      expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
      expect(readFileSync(join(home, '.dsh-home-migrations.json'), 'utf8')).toBe(marker)
    },
  )

  it('serializes two profile migrations across independent processes', async () => {
    const home = makeHome()
    const profileDirs = ['web', 'desktop'].map(name => makeProfile(
      home, name, '- id: session-log-deepseek\n  config: { enabled: true }\n',
    ))
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '- id: session-log-deepseek\n  config: { enabled: true }\n')
    writeFileSync(join(home, 'settings.yaml'), 'session-log-deepseek: { enabled: true }\n')
    const gate = join(home, 'start')
    const ready = profileDirs.map((_, index) => join(home, `ready-${index}`))
    const children = profileDirs.map((profileDir, index) => execa(
      process.execPath,
      ['--import', tsxLoader, childEntry, home, profileDir, ready[index]!, gate],
      { reject: false, timeout: CHILD_TIMEOUT_MS },
    ))
    let finished = false
    try {
      await withFileLock(homePatch, async () => {
        await Promise.all(ready.map(waitForFile))
        writeFileSync(gate, 'go\n')
        await Promise.all(profileDirs.map(profileDir => waitForFile(join(profileDir, 'package.json.lock'))))
      }, { waitMs: CHILD_TIMEOUT_MS })
      const results = await Promise.all(children)
      finished = true
      expect(results.map(result => result.exitCode)).toEqual([0, 0])
      for (const profileDir of profileDirs) {
        expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toContain('enabled: false')
        expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(true)
      }
      expect(readFileSync(homePatch, 'utf8')).not.toContain('enabled: true')
      expect(readFileSync(join(home, 'settings.yaml'), 'utf8')).toContain('enabled: false')
      expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(true)
    } finally {
      if (!finished) {
        writeFileSync(gate, 'go\n')
        for (const child of children) child.kill('SIGKILL')
        await Promise.allSettled(children)
      }
    }
  }, CHILD_TIMEOUT_MS + 10_000)
})
