import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import * as SessionLogDeepSeek from '@deepseek-ai/dsh-session-log-deepseek'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { boot, initProfile, loadProfileDirectory, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Settings from '@deepseek-ai/dsh-settings'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { migrateSessionLogUploadDefaults } from '../src/session-log-upload-migration.ts'

const homes: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

async function firstRequestHasSessionLog(ctx: Context, id: string): Promise<boolean> {
  const session = ctx.sessions.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  const prepared = await ctx.deepseekLlmApiExtensions.prepare({
    body: { messages: [{ role: 'user', content: 'test' }] },
    signal: new AbortController().signal,
    sessionId: session.id,
  })
  return Object.hasOwn(prepared.fields, 'dsh_session_log')
}

it('lets Settings opt in after a home-only reset and keeps that choice at restart', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-upload-settings-'))
  homes.push(home)
  const profileDir = join(home, 'profiles', 'web')
  const installAnchor = join(home, 'package.json')
  const homePatchPath = join(home, 'cordis.patch.yml')
  mkdirSync(home, { recursive: true })
  writeFileSync(installAnchor, '{"name":"test-installation","version":"1.0.0"}\n')
  initProfile(profileDir, ['test-upload-bundle'])
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
  const profileManifestPath = join(profileDir, 'package.json')
  const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as Record<string, unknown>
  profileManifest['dependencies'] = { 'test-upload-bundle': '1.0.0' }
  writeFileSync(profileManifestPath, JSON.stringify(profileManifest, undefined, 2) + '\n')
  const bundleDir = join(profileDir, 'node_modules', 'test-upload-bundle')
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(
    join(bundleDir, 'package.json'),
    JSON.stringify({
      name: 'test-upload-bundle',
      version: '1.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }) + '\n',
  )
  writeFileSync(
    join(bundleDir, 'cordis.patch.yml'),
    [
      '- insert:',
      '    - id: config-editor',
      '      name: cordis:editor',
      '    - id: settings',
      '      name: cordis:settings',
      '    - id: session-log-deepseek',
      '      name: cordis:sessionLog',
      '',
    ].join('\n'),
  )
  writeFileSync(homePatchPath, '- id: session-log-deepseek\n  config: { enabled: true }\n')
  writeFileSync(
    join(home, 'settings.yaml'),
    ['shared: &legacy-upload { enabled: true }', 'session-log-deepseek: *legacy-upload', ''].join('\n'),
  )

  const start = async (): Promise<Context> => {
    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatchPath)
    const profile = loadProfileDirectory('dsh-test', profileDir, installAnchor)
    const profileContext: ProfileContext = {
      name: 'web',
      dir: profileDir,
      patchPath: profile.patchPath,
      installAnchor,
      cwd: home,
      home,
      startedBundles: profile.layers.map((layer) => layer.packageName),
      overlays: [],
      telemetryDisabledEnv: undefined,
    }
    const ctx = await boot(
      'dsh-test',
      join(profileDir, 'cordis.yml'),
      readProfilePatches('dsh-test', profileContext, profile),
      async (ctx) => {
        ctx.provide('profileContext', profileContext)
        await ctx.plugin(SessionStore)
        await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
        Object.assign(ctx.loader.builtins, {
          editor: ConfigEditor,
          settings: Settings,
          sessionLog: SessionLogDeepSeek,
        })
      },
    )
    contexts.push(ctx)
    return ctx
  }

  const first = await start()
  await vi.waitFor(() => {
    expect(first.settings.describe().find((row) => row.ns === 'session-log-deepseek')?.value).toEqual({ enabled: false })
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toContain('enabled: false')
  })
  try {
    expect(readFileSync(homePatchPath, 'utf8')).not.toContain('config:')
    const importedLegacy = readFileSync(join(home, 'settings.yaml.imported'), 'utf8')
    expect(importedLegacy).toContain('shared: &legacy-upload { enabled: true }')
    expect(importedLegacy).toContain('session-log-deepseek: { enabled: false }')
    expect(await firstRequestHasSessionLog(first, 'legacy-migration-off')).toBe(false)
    await first.settings.update('session-log-deepseek', { enabled: true })
    expect(first.settings.describe().find((row) => row.ns === 'session-log-deepseek')?.value).toEqual({ enabled: true })
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toContain('enabled: true')
    expect(await firstRequestHasSessionLog(first, 'settings-opt-in')).toBe(true)
  } finally {
    await first.fiber.dispose()
  }

  const restarted = await start()
  try {
    expect(restarted.settings.describe().find((row) => row.ns === 'session-log-deepseek')?.value).toEqual({ enabled: true })
    expect(readFileSync(homePatchPath, 'utf8')).not.toContain('config:')
    expect(await firstRequestHasSessionLog(restarted, 'settings-opt-in-restart')).toBe(true)
  } finally {
    await restarted.fiber.dispose()
  }
})
