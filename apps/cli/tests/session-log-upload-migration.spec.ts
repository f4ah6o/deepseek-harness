import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { execa } from 'execa'
import { isScalar, parseDocument } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
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
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `profile-${name}`,
      private: true,
      dsh: { profile: { bundles: [] } },
    }) + '\n',
  )
  writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  return dir
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + CHILD_TIMEOUT_MS
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`migration synchronization file did not appear: ${path}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('preboot Session-log upload migration', () => {
  it('resets saved profile, home, and legacy opt-ins while preserving surrounding YAML', async () => {
    const home = makeHome()
    const profileDir = makeProfile(
      home,
      'web',
      [
        '# profile comment',
        '- id: session-log-deepseek # entry note',
        '  config:',
        '    enabled: true # saved profile opt-in',
        '    keep: !!js "\'expression\'"',
        '- id: other',
        '  config: { enabled: true }',
        '',
      ].join('\n'),
    )
    const homePatch = join(home, 'cordis.patch.yml')
    const legacy = join(home, 'settings.yaml')
    writeFileSync(
      homePatch,
      [
        '# home comment',
        '- id: session-log-deepseek',
        '  config:',
        '    enabled: true # saved machine opt-in',
        '    keep: value',
        '- id: other',
        '  config: { enabled: true }',
        '',
      ].join('\n'),
    )
    writeFileSync(
      legacy,
      [
        '# legacy comment',
        'session-log-deepseek:',
        '  enabled: true # old importer value',
        '  keep: value',
        'other:',
        '  name: preserve',
        '  expression: !!js "\'legacy expression\'"',
        '',
      ].join('\n'),
    )

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
    expect(JSON.parse(readFileSync(join(profileDir, '.dsh-profile-migrations.json'), 'utf8'))).toEqual({ [MIGRATION_KEY]: 1 })
    expect(JSON.parse(readFileSync(join(home, '.dsh-home-migrations.json'), 'utf8'))).toEqual({ [MIGRATION_KEY]: 1 })
  })

  it('materializes uploader configs in saved insert rows and leaves shared aliases unchanged', async () => {
    const home = makeHome()
    const profileText = [
      '- insert:',
      '    - id: shared-config',
      '      config: &upload { enabled: true, keep: !!js "\'preserved\'" }',
      '    - id: session-log-deepseek',
      "      name: '@deepseek-ai/dsh-session-log-deepseek'",
      '      config: *upload',
      '',
    ].join('\n')
    const profileDir = makeProfile(home, 'web', profileText)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const migrated = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    expect(migrated).toContain('config: &upload { enabled: true, keep: !!js "\'preserved\'" }')
    expect(migrated).toContain('config: { enabled: false, keep: !!js "\'preserved\'" }')
  })

  it('removes an aliased home enabled scalar without changing its source value', async () => {
    const home = makeHome()
    const profileDir = makeProfile(home, 'web', '[]\n')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(
      homePatch,
      [
        '- insert:',
        '    - id: shared-value',
        '      config: { enabled: &enabled true }',
        '    - id: session-log-deepseek',
        "      name: '@deepseek-ai/dsh-session-log-deepseek'",
        '      config: { enabled: *enabled }',
        '',
      ].join('\n'),
    )

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const document = parseDocument(readFileSync(homePatch, 'utf8'))
    expect(document.getIn([0, 'insert', 0, 'config', 'enabled'])).toBe(true)
    expect(document.getIn([0, 'insert', 1, 'config'])).toBeUndefined()
    expect(readFileSync(homePatch, 'utf8')).toContain('enabled: &enabled true')
  })

  it('resets a legacy uploader map without changing another alias consumer', async () => {
    const home = makeHome()
    const profileDir = makeProfile(home, 'web', '[]\n')
    const homePatch = join(home, 'cordis.patch.yml')
    const legacy = join(home, 'settings.yaml')
    writeFileSync(homePatch, '[]\n')
    writeFileSync(legacy, ['session-log-deepseek: &upload { enabled: true }', 'unrelated: *upload', ''].join('\n'))

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const document = parseDocument(readFileSync(legacy, 'utf8'))
    expect(document.getIn(['session-log-deepseek', 'enabled'])).toBe(false)
    expect(document.getIn(['unrelated', 'enabled'])).toBe(true)
  })

  it('keeps aliases to a removed home enabled scalar resolvable', async () => {
    const home = makeHome()
    const profileDir = makeProfile(home, 'web', '[]\n')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(
      homePatch,
      [
        '- insert:',
        '    - id: session-log-deepseek',
        "      name: '@deepseek-ai/dsh-session-log-deepseek'",
        '      config: { enabled: &enabled true }',
        '    - id: unrelated',
        '      config: { retained: *enabled }',
        '',
      ].join('\n'),
    )

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const document = parseDocument(readFileSync(homePatch, 'utf8'))
    expect(document.getIn([0, 'insert', 0, 'config'])).toBeUndefined()
    expect(document.getIn([0, 'insert', 1, 'config', 'retained'])).toBe(true)
  })

  it('replaces an aliased profile and legacy enabled value without changing its source', async () => {
    const home = makeHome()
    const profileDir = makeProfile(
      home,
      'web',
      [
        '- insert:',
        '    - id: shared',
        '      config: { enabled: &profile-enabled true }',
        '    - id: session-log-deepseek',
        '      config:',
        '        enabled:',
        '',
        '          # uploader-specific note',
        '          *profile-enabled # uploader-specific inline note',
        '',
      ].join('\n'),
    )
    const homePatch = join(home, 'cordis.patch.yml')
    const legacy = join(home, 'settings.yaml')
    writeFileSync(homePatch, '[]\n')
    writeFileSync(legacy, ['shared: &legacy-enabled true', 'session-log-deepseek: { enabled: *legacy-enabled }', ''].join('\n'))

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const profileDocument = parseDocument(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'))
    expect(profileDocument.getIn([0, 'insert', 0, 'config', 'enabled'])).toBe(true)
    expect(profileDocument.getIn([0, 'insert', 1, 'config', 'enabled'])).toBe(false)
    const migratedEnabled = profileDocument.getIn([0, 'insert', 1, 'config', 'enabled'], true)
    if (!isScalar(migratedEnabled)) throw new Error('migrated uploader enabled value is not a YAML scalar')
    expect(migratedEnabled.commentBefore).toContain('uploader-specific note')
    expect(migratedEnabled.comment).toContain('uploader-specific inline note')
    expect(migratedEnabled.spaceBefore).toBe(true)
    const legacyDocument = parseDocument(readFileSync(legacy, 'utf8'))
    expect(legacyDocument.get('shared')).toBe(true)
    expect(legacyDocument.getIn(['session-log-deepseek', 'enabled'])).toBe(false)
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toContain('uploader-specific note')
  })

  it('resets a directly anchored profile enabled value without changing another consumer', async () => {
    const home = makeHome()
    const profileText = [
      '- id: session-log-deepseek',
      '  config: { enabled: &enabled true }',
      '- id: unrelated',
      '  config: { retained: *enabled }',
      '- id: unrelated-source',
      '  config: &unrelated { retained: true }',
      '- id: unrelated-alias',
      '  config: *unrelated',
      '',
    ].join('\n')
    const profileDir = makeProfile(home, 'web', profileText)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const document = parseDocument(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'))
    expect(document.getIn([0, 'config', 'enabled'])).toBe(false)
    expect(document.getIn([1, 'config', 'retained'])).toBe(true)
    const migrated = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    expect(migrated).toContain('&unrelated { retained: true }')
    expect(migrated).toContain('config: *unrelated')
  })

  it('materializes an anchored uploader config without changing another consumer', async () => {
    const home = makeHome()
    const profileText = [
      '- id: session-log-deepseek',
      '  config: &upload { enabled: true }',
      '- id: unrelated',
      '  config: { retained: *upload }',
      '',
    ].join('\n')
    const profileDir = makeProfile(home, 'web', profileText)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const document = parseDocument(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'))
    expect(document.getIn([0, 'config', 'enabled'])).toBe(false)
    expect(document.getIn([1, 'config', 'retained', 'enabled'])).toBe(true)
  })

  it('leaves non-map configs and nonliteral enabled values untouched', async () => {
    const home = makeHome()
    const profileText = [
      '- id: session-log-deepseek',
      '  config: null',
      '- id: session-log-deepseek',
      '  config: { keep: value }',
      '- id: session-log-deepseek',
      '  config: { enabled: { nested: true } }',
      '',
    ].join('\n')
    const profileDir = makeProfile(home, 'web', profileText)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(profileText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(true)
  })

  it('records completion when both optional saved patches are absent', async () => {
    const home = makeHome()
    const profileDir = makeProfile(home, 'web', '[]\n')
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    rmSync(profilePatch)

    await migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)

    expect(existsSync(profilePatch)).toBe(false)
    expect(existsSync(homePatch)).toBe(false)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(true)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(true)
  })

  it('replaces target enabled expressions without evaluation and preserves unrelated expressions', async () => {
    const home = makeHome()
    const profileDir = makeProfile(
      home,
      'web',
      [
        '- id: session-log-deepseek',
        '  config:',
        '    enabled: !!js "(() => { throw new Error(\'migration evaluated enabled\') })()"',
        '    keep: !!js "\'preserved\'"',
        '',
      ].join('\n'),
    )
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')
    writeFileSync(
      join(home, 'settings.yaml'),
      [
        'session-log-deepseek:',
        '  enabled: !!js "(() => { throw new Error(\'migration evaluated enabled\') })()"',
        '  keep: !!js "\'preserved\'"',
        '',
      ].join('\n'),
    )
    await migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)

    expect(readFileSync(profilePatch, 'utf8')).toContain('enabled: false')
    expect(readFileSync(profilePatch, 'utf8')).toContain('keep: !!js "\'preserved\'"')
    expect(readFileSync(join(home, 'settings.yaml'), 'utf8')).toContain('enabled: false')
    expect(readFileSync(join(home, 'settings.yaml'), 'utf8')).toContain('keep: !!js "\'preserved\'"')
  })

  it('fails before markers when an uploader config expression cannot be inspected', async () => {
    const home = makeHome()
    const profileText = '- id: session-log-deepseek\n  config: !!js "({ enabled: true })"\n'
    const profileDir = makeProfile(home, 'web', profileText)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')

    await expect(migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)).rejects.toThrow(
      /cannot safely inspect the Session-log config expression/,
    )

    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(profileText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it.each([
    [
      'insert sequence',
      ['- insert: &entries', '    - id: recursive-group', '      group: true', '      config: *entries', ''].join('\n'),
      /cyclic/,
    ],
    [
      'group sequence',
      [
        '- id: recursive-group',
        '  group: true',
        '  config: &entries',
        '    - id: recursive-group',
        '      group: true',
        '      config: *entries',
        '',
      ].join('\n'),
      /cyclic/,
    ],
  ] as const)('fails before markers when a saved patch contains a cyclic %s', async (_kind, patchText, message) => {
    const home = makeHome()
    const profileDir = makeProfile(home, 'web', '[]\n')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, patchText)

    await expect(migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)).rejects.toThrow(
      message,
    )

    expect(readFileSync(homePatch, 'utf8')).toBe(patchText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it('resets a nested uploader under a literal Cordis group', async () => {
    const home = makeHome()
    const profilePatch = [
      '- id: uploader-group',
      '  group: true',
      '  config:',
      '    - id: session-log-deepseek',
      '      config: { enabled: true }',
      '',
    ].join('\n')
    const profileDir = makeProfile(home, 'web', profilePatch)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const document = parseDocument(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'))
    expect(document.getIn([0, 'config', 0, 'config', 'enabled'])).toBe(false)
  })

  it.each([
    ['insert', '- id: dynamic\n  insert: !!js "[]"\n', /dynamic Cordis insert/],
    ['group', '- id: dynamic\n  group: true\n  config: !!js "[]"\n', /dynamic Cordis group/],
    ['legacy settings', 'session-log-deepseek: !!js "({ enabled: true })"\n', /Session-log settings expression/],
  ] as const)('fails closed for a dynamic Cordis %s', async (_kind, profileText, message) => {
    const home = makeHome()
    const legacy = _kind === 'legacy settings'
    const profilePatch = legacy ? '[]\n' : profileText
    const profileDir = makeProfile(home, 'web', profilePatch)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')
    if (legacy) writeFileSync(join(home, 'settings.yaml'), profileText)

    await expect(migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)).rejects.toThrow(
      message,
    )
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(profilePatch)
    if (legacy) expect(readFileSync(join(home, 'settings.yaml'), 'utf8')).toBe(profileText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it('fails closed when a saved profile patch is not a Cordis sequence', async () => {
    const home = makeHome()
    const profileText = 'session-log-deepseek: { enabled: true }\n'
    const profileDir = makeProfile(home, 'web', profileText)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')

    await expect(migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)).rejects.toThrow(
      /not a YAML sequence/,
    )
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(profileText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it('fails closed when a static Cordis insert is not a sequence', async () => {
    const home = makeHome()
    const profileText = '- id: invalid-insert\n  insert: {}\n'
    const profileDir = makeProfile(home, 'web', profileText)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')

    await expect(migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)).rejects.toThrow(
      /cannot safely inspect Cordis insert/,
    )
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(profileText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it.each([
    ['no uploader section', 'other: { retained: true }\n'],
    ['non-map uploader section', 'session-log-deepseek: true\n'],
    ['non-scalar enabled setting', 'session-log-deepseek: { enabled: [true] }\n'],
  ] as const)('preserves legacy settings with %s', async (_kind, legacyText) => {
    const home = makeHome()
    const profileDir = makeProfile(home, 'web', '[]\n')
    const homePatch = join(home, 'cordis.patch.yml')
    const legacy = join(home, 'settings.yaml')
    writeFileSync(homePatch, '[]\n')
    writeFileSync(legacy, legacyText)

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    expect(readFileSync(legacy, 'utf8')).toBe(legacyText)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(true)
  })

  it('resets an anchored legacy enabled value without changing another consumer', async () => {
    const home = makeHome()
    const profileDir = makeProfile(home, 'web', '[]\n')
    const homePatch = join(home, 'cordis.patch.yml')
    const legacy = join(home, 'settings.yaml')
    writeFileSync(homePatch, '[]\n')
    writeFileSync(legacy, ['session-log-deepseek:', '  enabled: &enabled true', 'unrelated: { retained: *enabled }', ''].join('\n'))

    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)

    const document = parseDocument(readFileSync(legacy, 'utf8'))
    expect(document.getIn(['session-log-deepseek', 'enabled'])).toBe(false)
    expect(document.getIn(['unrelated', 'retained'])).toBe(true)
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

  it.each(['profile patch', 'home patch', 'legacy settings'] as const)(
    'fails before committing edits when %s is malformed',
    async (broken) => {
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
    },
  )

  it('fails closed and leaves migration markers absent when an atomic save fails', async () => {
    const home = makeHome()
    const profileText = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    const profileDir = makeProfile(home, 'web', profileText)
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, profileText)
    vi.mocked(writeFileAtomic).mockImplementationOnce(async () => {
      throw new Error('disk write failed')
    })

    await expect(migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)).rejects.toThrow('disk write failed')

    expect(readFileSync(profilePatch, 'utf8')).toBe(profileText)
    expect(readFileSync(homePatch, 'utf8')).toBe(profileText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it.each([
    ['array root', '[]\n', /invalid format/],
    ['zero version', '{"f4ah6o/deepseek-harness/session-log-upload-default-off":0}\n', /invalid format/],
    ['invalid JSON', '{\n', /not valid JSON/],
  ] as const)('fails closed when the shared-home migration marker is invalid (%s)', async (_kind, marker, message) => {
    const home = makeHome()
    const profileText = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    const profileDir = makeProfile(home, 'web', profileText)
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, profileText)
    writeFileSync(join(home, '.dsh-home-migrations.json'), marker)

    await expect(migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatch)).rejects.toThrow(
      message,
    )

    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(profileText)
    expect(readFileSync(homePatch, 'utf8')).toBe(profileText)
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(false)
    expect(readFileSync(join(home, '.dsh-home-migrations.json'), 'utf8')).toBe(marker)
  })

  it('preserves unrelated marker versions and retries after the shared-home marker write fails', async () => {
    const home = makeHome()
    const profileText = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    const profileDir = makeProfile(home, 'web', profileText)
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    const legacy = join(home, 'settings.yaml')
    const profileMarker = join(profileDir, '.dsh-profile-migrations.json')
    const homeMarker = join(home, '.dsh-home-migrations.json')
    writeFileSync(homePatch, profileText)
    writeFileSync(legacy, 'session-log-deepseek: { enabled: true }\n')
    writeFileSync(profileMarker, '{"other/profile":2}\n')
    writeFileSync(homeMarker, '{"other/home":3}\n')

    const writer = vi.mocked(writeFileAtomic)
    const passThrough = writer.getMockImplementation()
    expect(passThrough).toBeDefined()
    for (let index = 0; index < 4; index++) writer.mockImplementationOnce((...args) => passThrough!(...args))
    writer.mockImplementationOnce(async (path, ..._args) => {
      expect(path).toBe(homeMarker)
      throw new Error('home marker write failed')
    })

    await expect(migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)).rejects.toThrow('home marker write failed')

    expect(writer.mock.calls.map(([path]) => path)).toEqual([profilePatch, homePatch, legacy, profileMarker, homeMarker])
    expect(JSON.parse(readFileSync(profileMarker, 'utf8'))).toEqual({
      'other/profile': 2,
      [MIGRATION_KEY]: 1,
    })
    expect(JSON.parse(readFileSync(homeMarker, 'utf8'))).toEqual({ 'other/home': 3 })
    expect(readFileSync(profilePatch, 'utf8')).toContain('enabled: false')
    expect(readFileSync(legacy, 'utf8')).toContain('enabled: false')

    const explicitOptIn = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    writeFileSync(profilePatch, explicitOptIn)
    writer.mockClear()
    await migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)

    expect(readFileSync(profilePatch, 'utf8')).toBe(explicitOptIn)
    expect(writer.mock.calls.map(([path]) => path)).toEqual([homeMarker])
    expect(JSON.parse(readFileSync(profileMarker, 'utf8'))).toEqual({
      'other/profile': 2,
      [MIGRATION_KEY]: 1,
    })
    expect(JSON.parse(readFileSync(homeMarker, 'utf8'))).toEqual({
      'other/home': 3,
      [MIGRATION_KEY]: 1,
    })
  })

  it('rejects an invalid profile marker before editing saved YAML', async () => {
    const home = makeHome()
    const profileText = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    const profileDir = makeProfile(home, 'web', profileText)
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    const markerPath = join(profileDir, '.dsh-profile-migrations.json')
    writeFileSync(homePatch, profileText)
    writeFileSync(markerPath, '{\n')

    await expect(migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)).rejects.toThrow(/not valid JSON/)

    expect(readFileSync(profilePatch, 'utf8')).toBe(profileText)
    expect(readFileSync(homePatch, 'utf8')).toBe(profileText)
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it.each(['profile marker', 'profile patch'] as const)('fails closed when the %s cannot be read', async (unreadable) => {
    const home = makeHome()
    const profileText = '- id: session-log-deepseek\n  config: { enabled: true }\n'
    const profileDir = makeProfile(home, 'web', profileText)
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')
    if (unreadable === 'profile marker') {
      mkdirSync(join(profileDir, '.dsh-profile-migrations.json'))
    } else {
      rmSync(profilePatch)
      mkdirSync(profilePatch)
    }

    await expect(migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)).rejects.toThrow(
      unreadable === 'profile marker' ? /cannot read migration marker/ : /cannot read .* for the Session-log upload migration/,
    )
    expect(existsSync(join(profileDir, '.dsh-profile-migrations.json'))).toBe(unreadable === 'profile marker')
    expect(existsSync(join(home, '.dsh-home-migrations.json'))).toBe(false)
  })

  it('fails when the profile manifest is absent', async () => {
    const home = makeHome()
    const profileDir = join(home, 'profiles', 'missing')

    await expect(
      migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, join(home, 'cordis.patch.yml')),
    ).rejects.toThrow(/before the profile manifest exists/)
  })

  it(
    'serializes two profile migrations across independent processes',
    async () => {
      const home = makeHome()
      const profileDirs = ['web', 'desktop'].map((name) =>
        makeProfile(home, name, '- id: session-log-deepseek\n  config: { enabled: true }\n'),
      )
      const homePatch = join(home, 'cordis.patch.yml')
      writeFileSync(homePatch, '- id: session-log-deepseek\n  config: { enabled: true }\n')
      writeFileSync(join(home, 'settings.yaml'), 'session-log-deepseek: { enabled: true }\n')
      const gate = join(home, 'start')
      const ready = profileDirs.map((_, index) => join(home, `ready-${index}`))
      const children = profileDirs.map((profileDir, index) =>
        execa(process.execPath, ['--import', tsxLoader, childEntry, home, profileDir, ready[index]!, gate], {
          reject: false,
          timeout: CHILD_TIMEOUT_MS,
        }),
      )
      let finished = false
      try {
        await withFileLock(
          homePatch,
          async () => {
            await Promise.all(ready.map(waitForFile))
            writeFileSync(gate, 'go\n')
            await Promise.all(profileDirs.map((profileDir) => waitForFile(join(profileDir, 'package.json.lock'))))
          },
          { waitMs: CHILD_TIMEOUT_MS },
        )
        const results = await Promise.all(children)
        finished = true
        expect(results.map((result) => result.exitCode)).toEqual([0, 0])
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
    },
    CHILD_TIMEOUT_MS + 10_000,
  )
})
