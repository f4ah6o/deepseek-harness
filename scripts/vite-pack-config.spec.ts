import { describe, expect, it } from 'vite-plus/test'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord)
}

async function loadPackageConfig(face: 'host' | 'client'): Promise<Record<string, unknown>> {
  const previousFace = process.env.DSH_BUILD_FACE
  process.env.DSH_BUILD_FACE = face
  try {
    const configUrl = new URL(`../packages/client/ui-chat/vite.config.ts?face=${face}`, import.meta.url).href
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
    const host = await loadPackageConfig('host')
    const client = await loadPackageConfig('client')
    const hostPack = host.pack
    const clientPack = client.pack
    expect(isRecordArray(hostPack)).toBe(true)
    expect(isRecordArray(clientPack)).toBe(true)
    if (!isRecordArray(hostPack) || !isRecordArray(clientPack)) throw new Error('pack config must be an array of objects')
    expect(hostPack.some((config) => config.entry === '')).toBe(true)
    expect(clientPack.some((config) => isRecord(config.entry) && 'client' in config.entry)).toBe(true)
  })
})
