import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as SessionLogDeepSeek from '@deepseek-ai/dsh-session-log-deepseek'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateSessionLogUploadDefaults } from '../src/session-log-upload-migration.ts'

const homes: string[] = []
const contexts: Context[] = []

function configuredEnabled(config: unknown): boolean | undefined {
  if (typeof config !== 'object' || config === null) return undefined
  const enabled: unknown = Reflect.get(config, 'enabled')
  return typeof enabled === 'boolean' ? enabled : undefined
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function makeProfile(home: string, patch: string): string {
  const profileDir = join(home, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), '{"name":"web","private":true}\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), patch)
  return profileDir
}

async function firstRequestHasSessionLog(enabled: boolean | undefined, id: string): Promise<boolean> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
  await ctx.plugin(SessionLogDeepSeek, enabled === undefined ? {} : { enabled })
  const session = ctx.sessions.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  const prepared = await ctx.deepseekLlmApiExtensions.prepare({
    body: { messages: [{ role: 'user', content: 'test' }] },
    signal: new AbortController().signal,
    sessionId: session.id,
  })
  return Object.hasOwn(prepared.fields, 'dsh_session_log')
}

describe('session-log migration through real patch composition', () => {
  it('resets a profile uploader inserted by a saved patch while preserving an aliased source', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-upload-profile-alias-'))
    homes.push(home)
    const profileDir = makeProfile(home, [
      '- insert:',
      '    - id: shared-config',
      '      config: &upload { enabled: !!js "true" }',
      '    - id: session-log-deepseek',
      "      name: '@deepseek-ai/dsh-session-log-deepseek'",
      '      config: *upload',
      '',
    ].join('\n'))
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, '[]\n')

    await migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)

    const patches = loadOverlayPatches('dsh-test', profilePatch)
    const entries = composeEntries([patches])
    expect(entries.map(entry => entry.id)).toEqual(['shared-config', 'session-log-deepseek'])
    const shared = entries.find(entry => entry.id === 'shared-config')
    const uploader = entries.find(entry => entry.id === 'session-log-deepseek')
    expect(shared?.config).toEqual({ enabled: { __jsExpr: 'true' } })
    const enabled = configuredEnabled(uploader?.config)
    expect(enabled).toBe(false)
    expect(await firstRequestHasSessionLog(enabled, 'profile-alias-reset'))
      .toBe(false)
    expect(readFileSync(profilePatch, 'utf8')).toContain('config: { enabled: false }')
  })

  it('removes a home uploader inserted with an enabled alias before the first request', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-upload-home-alias-'))
    homes.push(home)
    const profileDir = makeProfile(home, '[]\n')
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    writeFileSync(homePatch, [
      '- insert:',
      '    - id: shared-value',
      '      config: { enabled: &enabled true }',
      '    - id: session-log-deepseek',
      "      name: '@deepseek-ai/dsh-session-log-deepseek'",
      '      config: { enabled: *enabled }',
      '',
    ].join('\n'))

    await migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)

    const layers = [
      loadOverlayPatches('dsh-test', profilePatch),
      loadOverlayPatches('dsh-test', homePatch),
    ]
    const entries = composeEntries(layers)
    expect(entries.map(entry => entry.id)).toEqual(['shared-value', 'session-log-deepseek'])
    const shared = entries.find(entry => entry.id === 'shared-value')
    const uploader = entries.find(entry => entry.id === 'session-log-deepseek')
    expect(shared?.config).toEqual({ enabled: true })
    expect(uploader?.config).toBeUndefined()
    const enabled = configuredEnabled(uploader?.config)
    expect(await firstRequestHasSessionLog(enabled, 'home-alias-reset'))
      .toBe(false)
    expect(readFileSync(homePatch, 'utf8')).toContain('enabled: &enabled true')
  })

  it('turns a legacy enabled expression into the profile value used by composition', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-upload-legacy-expression-'))
    homes.push(home)
    const profileDir = makeProfile(home, '[]\n')
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    const legacy = join(home, 'settings.yaml')
    writeFileSync(homePatch, '[]\n')
    writeFileSync(legacy, [
      'session-log-deepseek:',
      '  enabled: !!js "(() => { throw new Error(\'migration evaluated enabled\') })()"',
      '',
    ].join('\n'))

    await migrateSessionLogUploadDefaults(profileDir, profilePatch, home, homePatch)

    expect(readFileSync(legacy, 'utf8')).toContain('enabled: false')
    writeFileSync(profilePatch, '- id: session-log-deepseek\n  config: { enabled: false }\n')
    const basePatch = join(home, 'base.patch.yml')
    writeFileSync(basePatch, [
      '- insert:',
      '    - id: session-log-deepseek',
      "      name: '@deepseek-ai/dsh-session-log-deepseek'",
      '      config: { enabled: false }',
      '',
    ].join('\n'))
    const entries = composeEntries([
      loadOverlayPatches('dsh-test', basePatch),
      loadOverlayPatches('dsh-test', profilePatch),
    ])
    const uploader = entries.find(entry => entry.id === 'session-log-deepseek')
    const enabled = configuredEnabled(uploader?.config)
    expect(enabled).toBe(false)
    expect(await firstRequestHasSessionLog(enabled, 'legacy-expression-reset')).toBe(false)
  })
})
