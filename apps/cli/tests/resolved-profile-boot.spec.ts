/** Application-owned profiles share the named profile launch lifecycle. */
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import {
  boot, composeEntries, createRuntimeResolution, initProfile,
  PluginPackages,
} from '@deepseek-ai/dsh-app-boot'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProfile } from '../src/profile-boot.ts'

vi.mock('@deepseek-ai/dsh-app-boot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-app-boot')>()
  return {
    ...actual,
    boot: vi.fn(),
    createRuntimeResolution: vi.fn(actual.createRuntimeResolution),
    installFailLoud: vi.fn(),
  }
})
vi.mock('@deepseek-ai/dsh-http-proxy', () => ({ installProxyFromEnvironment: vi.fn() }))

const homes: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('runProfile with an application-owned profile', () => {
  it.each(
    ['composition', 'boot', 'watch', 'cleanup', 'tree-cleanup', 'both-cleanups'] as const,
  )('releases startup resources after a %s failure', async (stage) => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-startup-failure-'))
    homes.push(home)
    mkdirSync(join(home, 'runtime'))
    writeFileSync(join(home, 'runtime/package.json'), '{"name":"test-runtime","version":"1.0.0"}')
    writeFileSync(join(home, 'package.json'), '{"name":"test-bundle","version":"1.0.0"}')
    vi.stubEnv('DSH_HOME', home)
    vi.spyOn(process, 'on').mockReturnValue(process)
    const ctx = new Context()
    ctx.provide('loader', { create: vi.fn() })
    ctx.provide('hmr', {})
    const dispose = vi.spyOn(ctx.fiber, 'dispose')
    const failure = new Error('startup failed')
    const cleanupFailure = new Error('proxy cleanup failed')
    const treeCleanupFailure = new Error('tree cleanup failed')
    if (stage === 'tree-cleanup' || stage === 'both-cleanups') dispose.mockRejectedValueOnce(treeCleanupFailure)
    const disposeProxy = vi.fn().mockImplementation(() => stage === 'cleanup' || stage === 'both-cleanups'
      ? Promise.reject(cleanupFailure)
      : Promise.resolve())
    vi.mocked(installProxyFromEnvironment).mockResolvedValue(disposeProxy)
    vi.mocked(boot).mockImplementation(async (_name, _root, _patches, setup) => {
      await setup?.(ctx)
      throw failure
    })
    if (stage === 'composition') vi.mocked(createRuntimeResolution).mockRejectedValueOnce(failure)
    try {
      const application = runProfile({
        environment: createLaunchEnvironmentSnapshot([]), profile: 'desktop', patchFiles: [], args: ['--no-open'],
        resolvedProfile: { profileDir: home, installAnchor: join(home, 'runtime/package.json') },
      })
      if (stage === 'both-cleanups') {
        await expect(application).rejects.toMatchObject({ errors: [failure, { errors: [treeCleanupFailure, cleanupFailure] }] })
      } else if (stage === 'tree-cleanup') {
        await expect(application).rejects.toMatchObject({ errors: [failure, treeCleanupFailure] })
      } else if (stage === 'cleanup') {
        await expect(application).rejects.toMatchObject({ errors: [failure, cleanupFailure] })
      } else {
        await expect(application).rejects.toBe(failure)
      }
      expect(disposeProxy).toHaveBeenCalledOnce()
      expect(boot).toHaveBeenCalledTimes(stage === 'composition' ? 0 : 1)
      expect(dispose).toHaveBeenCalledTimes(stage === 'composition' ? 0 : 1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('uses shared layers, runtime resolution, and shutdown', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-resolved-profile-'))
    homes.push(home)
    const profileDir = join(home, 'profiles', 'desktop')
    mkdirSync(join(home, 'runtime'))
    writeFileSync(join(home, 'runtime/package.json'), '{"name":"test-runtime","version":"1.0.0","exports":"./index.cjs"}')
    writeFileSync(join(home, 'runtime/index.cjs'), 'module.exports = "installation"\n')
    initProfile(profileDir, ['test-bundle'])
    const profileManifestPath = join(profileDir, 'package.json')
    const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as Record<string, unknown>
    profileManifest.dependencies = { 'test-bundle': '1.0.0' }
    writeFileSync(profileManifestPath, JSON.stringify(profileManifest, undefined, 2) + '\n')
    const bundleDir = join(profileDir, 'node_modules/test-bundle')
    mkdirSync(bundleDir, { recursive: true })
    writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
      name: 'test-bundle', version: '1.0.0', dependencies: { 'test-local': '*' },
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }) + '\n')
    writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: target',
      '      name: target',
      '      config: { bundle: true, priority: bundle }',
      '    - id: session-telemetry-otel',
      '      name: telemetry',
      '',
    ].join('\n'))
    const localPackageDir = join(profileDir, 'node_modules/test-local')
    mkdirSync(localPackageDir, { recursive: true })
    const localManifest = '{"name":"test-local","version":"1.0.0","exports":"./index.cjs"}'
    writeFileSync(join(localPackageDir, 'package.json'), localManifest)
    writeFileSync(join(localPackageDir, 'index.cjs'), 'module.exports = "profile"\n')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')
    vi.spyOn(process, 'on').mockReturnValue(process)
    const oldExitCode = process.exitCode
    const ctx = new Context()
    const plugin = vi.spyOn(ctx, 'plugin')
    // The real context supplies services; this test substitutes tree mounting and filesystem watchers.
    ctx.provide('loader', { create: vi.fn() })
    ctx.provide('hmr', {})
    const dispose = vi.spyOn(ctx.fiber, 'dispose')
    const disposeProxy = vi.fn().mockResolvedValue(undefined)
    vi.mocked(installProxyFromEnvironment).mockResolvedValue(disposeProxy)
    vi.mocked(boot).mockImplementation(async (_name, _root, _patches, setup) => {
      await setup?.(ctx)
      return ctx
    })
    const homePatch = join(home, 'cordis.patch.yml')
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const overlay = join(home, 'desktop.patch.yml')
    writeFileSync(homePatch, '- id: target\n  config: { home: true, priority: home }\n')
    writeFileSync(profilePatch, '- id: target\n  config: { profile: true, priority: profile }\n')
    writeFileSync(overlay, '- id: target\n  config: { overlay: true, priority: overlay }\n')
    writeFileSync(join(profileDir, 'cordis.yml'), '- id: stale\n')
    const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { HTTPS_PROXY: 'http://localhost:8080' } }])
    const runtime = { profileDir, installAnchor: join(home, 'runtime/package.json') }
    try {
      const { shutdown } = await runProfile({
        environment, profile: 'desktop', resolvedProfile: runtime,
        patchFiles: [overlay], args: ['--port', '0', '--no-open'],
      })
      expect(installProxyFromEnvironment).toHaveBeenCalledWith(environment, expect.any(Function))
      const resolution = vi.mocked(createRuntimeResolution).mock.settledResults
        .find(result => result.type === 'fulfilled')?.value
      expect(resolution?.profileDir).toBe(profileDir)
      expect(plugin).toHaveBeenCalledWith(PluginPackages, { resolution })
      expect(lstatSync(localPackageDir).isDirectory()).toBe(true)
      expect(readFileSync(join(localPackageDir, 'package.json'), 'utf8')).toBe(localManifest)
      const requireFromProfile = createRequire(join(profileDir, 'package.json'))
      expect(requireFromProfile('test-runtime')).toBe('installation')
      expect(requireFromProfile('test-local')).toBe('profile')
      expect(readFileSync(join(profileDir, 'cordis.yml'), 'utf8')).not.toContain('stale')
      expect(ctx.cmdlineArgs!.get()).toEqual(['--port', '0', '--no-open'])
      const ready = vi.fn()
      ctx.appReady!.onReady(ready)
      expect(ready).toHaveBeenCalledOnce()
      const patches = vi.mocked(boot).mock.calls[0]![2]!
      const rows = composeEntries([patches])
      expect(patches.slice(1, 4)).toEqual([
        { id: 'target', config: { profile: true, priority: 'profile' } },
        { id: 'target', config: { home: true, priority: 'home' } },
        { id: 'target', config: { overlay: true, priority: 'overlay' } },
      ])
      expect(rows.find(row => row.id === 'target')?.config).toEqual({ overlay: true, priority: 'overlay' })
      expect(rows.find(row => row.id === 'session-telemetry-otel')?.disabled).toBe(true)
      expect(ctx.profileContext).toMatchObject({ dir: profileDir, patchPath: profilePatch, installAnchor: runtime.installAnchor })
      await shutdown.shutdown(0)
      expect(dispose).toHaveBeenCalledOnce()
      expect(disposeProxy).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
      process.exitCode = oldExitCode
    }
  })

  it('resets saved opt-ins before the first boot while preserving an explicit CLI overlay', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-upload-preboot-'))
    homes.push(home)
    const profileDir = join(home, 'profiles', 'desktop')
    mkdirSync(profileDir, { recursive: true })
    mkdirSync(join(home, 'runtime'))
    const profilePatch = join(profileDir, 'cordis.patch.yml')
    const homePatch = join(home, 'cordis.patch.yml')
    const legacy = join(home, 'settings.yaml')
    const overlay = join(home, 'opt-in.patch.yml')
    initProfile(profileDir, ['test-bundle'])
    const profileManifestPath = join(profileDir, 'package.json')
    const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as Record<string, unknown>
    profileManifest.dependencies = { 'test-bundle': '1.0.0' }
    writeFileSync(profileManifestPath, JSON.stringify(profileManifest, undefined, 2) + '\n')
    const bundleDir = join(profileDir, 'node_modules/test-bundle')
    mkdirSync(bundleDir, { recursive: true })
    writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
      name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }) + '\n')
    writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: session-log-deepseek',
      '      name: cordis:sessionLog',
      '      config: { base: keep }',
      '',
    ].join('\n'))
    writeFileSync(join(home, 'runtime/package.json'), '{"name":"test-runtime","version":"1.0.0"}\n')
    writeFileSync(profilePatch, '- id: session-log-deepseek\n  config: { enabled: true, profile: keep }\n')
    writeFileSync(homePatch, '- id: session-log-deepseek\n  config: { enabled: true, home: keep }\n')
    writeFileSync(legacy, 'session-log-deepseek: { enabled: true, legacy: keep }\n')
    const overlayText = '- id: session-log-deepseek\n  config: { enabled: true, cli: keep }\n'
    writeFileSync(overlay, overlayText)
    vi.stubEnv('DSH_HOME', home)
    vi.spyOn(process, 'on').mockReturnValue(process)
    const ctx = new Context()
    ctx.provide('loader', { create: vi.fn() })
    ctx.provide('hmr', {})
    const disposeProxy = vi.fn().mockResolvedValue(undefined)
    vi.mocked(installProxyFromEnvironment).mockResolvedValue(disposeProxy)
    vi.mocked(boot).mockImplementation(async (_name, _root, _patches, setup) => {
      await setup?.(ctx)
      return ctx
    })
    const originalExitCode = process.exitCode
    try {
      const { shutdown } = await runProfile({
        environment: createLaunchEnvironmentSnapshot([]), profile: 'desktop', patchFiles: [overlay], args: [],
        resolvedProfile: { profileDir, installAnchor: join(home, 'runtime/package.json') },
      })

      const patches = vi.mocked(boot).mock.calls[0]![2]!
      const uploaderRows = patches.filter(row => row.id === 'session-log-deepseek')
      const effective = composeEntries([patches]).find(row => row.id === 'session-log-deepseek')
      expect(uploaderRows[0]?.config).toEqual({ enabled: false, profile: 'keep' })
      expect(uploaderRows[1]?.config).toEqual({ home: 'keep' })
      expect(uploaderRows[2]?.config).toEqual({ enabled: true, cli: 'keep' })
      expect(readFileSync(profilePatch, 'utf8')).toContain('enabled: false')
      expect(readFileSync(homePatch, 'utf8')).not.toContain('enabled: true')
      expect(readFileSync(legacy, 'utf8')).toContain('enabled: false')
      expect(readFileSync(overlay, 'utf8')).toBe(overlayText)
      expect(effective?.config).toEqual({ enabled: true, cli: 'keep' })
      await shutdown.shutdown(0)
    } finally {
      await ctx.fiber.dispose()
      process.exitCode = originalExitCode
    }
  })

  it('does not boot or register request contributors when the preboot migration cannot parse a patch', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-upload-preboot-failure-'))
    homes.push(home)
    const profileDir = join(home, 'profiles', 'desktop')
    mkdirSync(profileDir, { recursive: true })
    mkdirSync(join(home, 'runtime'))
    writeFileSync(join(profileDir, 'package.json'), '{"name":"desktop-profile","private":true,"dsh":{"profile":{"bundles":[]}}}\n')
    writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(home, 'runtime/package.json'), '{"name":"test-runtime","version":"1.0.0"}\n')
    writeFileSync(join(home, 'cordis.patch.yml'), '- id: [\n')
    vi.stubEnv('DSH_HOME', home)
    const disposeProxy = vi.fn().mockResolvedValue(undefined)
    vi.mocked(installProxyFromEnvironment).mockResolvedValue(disposeProxy)
    await expect(runProfile({
      environment: createLaunchEnvironmentSnapshot([]), profile: 'desktop', patchFiles: [], args: [],
      resolvedProfile: { profileDir, installAnchor: join(home, 'runtime/package.json') },
    })).rejects.toThrow(/invalid YAML/)

    expect(boot).not.toHaveBeenCalled()
    expect(disposeProxy).toHaveBeenCalledOnce()
  })
})
