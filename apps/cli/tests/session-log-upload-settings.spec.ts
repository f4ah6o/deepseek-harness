import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import {
  boot, initProfile, loadProfileDirectory, readProfilePatches, type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import Settings from '@deepseek-ai/dsh-settings'
import { afterEach, expect, it } from 'vitest'
import { migrateSessionLogUploadDefaults } from '../src/session-log-upload-migration.ts'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

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
  writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
    name: 'test-upload-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }) + '\n')
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: config-editor',
    '      name: cordis:editor',
    '    - id: settings',
    '      name: cordis:settings',
    '    - id: session-log-deepseek',
    '      name: cordis:sessionLog',
    '',
  ].join('\n'))
  writeFileSync(homePatchPath, '- id: session-log-deepseek\n  config: { enabled: true }\n')

  const start = async (): Promise<Context> => {
    await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, homePatchPath)
    const profile = loadProfileDirectory('dsh-test', profileDir, installAnchor)
    const profileContext: ProfileContext = {
      name: 'web', dir: profileDir, patchPath: profile.patchPath, installAnchor,
      cwd: home, home, startedBundles: profile.layers.map(layer => layer.packageName),
      overlays: [], telemetryDisabledEnv: undefined,
    }
    return boot('dsh-test', join(profileDir, 'cordis.yml'), readProfilePatches('dsh-test', profileContext, profile), (ctx) => {
      ctx.provide('profileContext', profileContext)
      Object.assign(ctx.loader.builtins, {
        editor: ConfigEditor,
        settings: Settings,
        sessionLog: {
          Config: z.object({ enabled: z.boolean().default(false).volatile() }),
          apply: () => {},
        },
      })
    })
  }

  const first = await start()
  try {
    expect(first.settings.describe().find(row => row.ns === 'session-log-deepseek')?.value)
      .toEqual({ enabled: false })
    expect(readFileSync(homePatchPath, 'utf8')).not.toContain('config:')
    await first.settings.update('session-log-deepseek', { enabled: true })
    expect(first.settings.describe().find(row => row.ns === 'session-log-deepseek')?.value)
      .toEqual({ enabled: true })
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toContain('enabled: true')
  } finally {
    await first.fiber.dispose()
  }

  const restarted = await start()
  try {
    expect(restarted.settings.describe().find(row => row.ns === 'session-log-deepseek')?.value)
      .toEqual({ enabled: true })
    expect(readFileSync(homePatchPath, 'utf8')).not.toContain('config:')
  } finally {
    await restarted.fiber.dispose()
  }
})
