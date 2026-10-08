import { describe, expect, it } from 'vite-plus/test'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord)
}

async function loadPackageConfig(path: string, face?: 'host' | 'client'): Promise<Record<string, unknown>> {
  const previousFace = process.env.DSH_BUILD_FACE
  if (face === undefined) delete process.env.DSH_BUILD_FACE
  else process.env.DSH_BUILD_FACE = face
  try {
    const configUrl = new URL(`../${path}/vite.config.ts?face=${face ?? 'default'}`, import.meta.url).href
    const loaded: unknown = await import(/* @vite-ignore */ configUrl)
    if (!isRecord(loaded) || !isRecord(loaded.default)) throw new Error('package Vite config must export an object')
    return loaded.default
  } finally {
    if (previousFace === undefined) delete process.env.DSH_BUILD_FACE
    else process.env.DSH_BUILD_FACE = previousFace
  }
}

describe('Vite+ package pack config', () => {
  it('materializes face-specific factories before the pack CLI spreads config', async () => {
    const host = await loadPackageConfig('packages/client/ui-chat', 'host')
    const client = await loadPackageConfig('packages/client/ui-chat', 'client')
    const hostPack = host.pack
    const clientPack = client.pack
    expect(isRecordArray(hostPack)).toBe(true)
    expect(isRecordArray(clientPack)).toBe(true)
    if (!isRecordArray(hostPack) || !isRecordArray(clientPack)) throw new Error('pack config must be an array of objects')
    expect(hostPack.some((config) => config.entry === '')).toBe(true)
    expect(clientPack.some((config) => isRecord(config.entry) && 'client' in config.entry)).toBe(true)
  })

  it('keeps closed Node library bundles within each package file whitelist', async () => {
    const clientRuntime = await loadPackageConfig('packages/test-support/client-runtime', 'client')
    const sessionSnapshot = await loadPackageConfig('packages/test-support/session-snapshot')
    const clientPack = clientRuntime.pack
    const snapshotPack = sessionSnapshot.pack
    expect(isRecordArray(clientPack)).toBe(true)
    expect(isRecordArray(snapshotPack)).toBe(true)
    if (!isRecordArray(clientPack) || !isRecordArray(snapshotPack)) throw new Error('pack config must be an array of objects')
    expect(clientPack).toContainEqual(expect.objectContaining({ outputOptions: { codeSplitting: false } }))
    expect(snapshotPack).toContainEqual(expect.objectContaining({ outputOptions: { codeSplitting: false } }))
  })
})
