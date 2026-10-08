/** Native initialization precedes Client mounting and does not persist automatic locale choices. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, LocaleRuntime } from '../src/client/index.ts'
import { parseLocaleBootstrap } from '../src/client/bootstrap.ts'
import type { LocaleSettings } from '../src/locale-settings.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('native locale initialization', () => {
  it('reports a failed native read instead of silently choosing a language', async () => {
    const ctx = new Context()
    const error = new Error('native settings unavailable')
    vi.stubGlobal('__DSH_LOCALE__', { read: () => Promise.reject(error), onChange: vi.fn() })
    try {
      await expect(apply(ctx)).rejects.toBe(error)
      expect(ctx.get('locale')).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('uses native language order before the Japanese pack registers without persisting a provisional choice', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' })
    const ctx = new Context()
    const host = stubConfigForm<LocaleSettings>()
    try {
      const locale = new LocaleRuntime(ctx, host.scope, { languages: ['ja-JP', 'zh-Hant', 'en-US'], preference: null })
      expect(locale.getSnapshot().active).toBe('zh')
      expect(host.set).not.toHaveBeenCalled()
      locale.setLocale('en')
      expect(host.set).toHaveBeenCalledExactlyOnceWith('preference', 'en')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('uses the registered default language after a late pack registers, regardless of system language', async () => {
    const ctx = new Context()
    try {
      const locale = new LocaleRuntime(ctx, undefined, { languages: ['en-US', 'zh-CN'], preference: null })
      expect(locale.getSnapshot().active).toBe('en')
      locale.register('native-test', 'ja', { title: '日本語' })
      locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en', default: true })
      expect(locale.getSnapshot().active).toBe('ja')
      expect(locale.bind('native-test')('title')).toBe('日本語')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each(['en', 'zh'] as const)('preserves saved %s after the default language registers', async (preference) => {
    const ctx = new Context()
    try {
      const locale = new LocaleRuntime(ctx, undefined, { languages: ['ja-JP'], preference })
      locale.register('native-test', 'ja', { title: '日本語' })
      locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en', default: true })
      expect(locale.getSnapshot().active).toBe(preference)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps the stored choice while dictionaries and languages register', async () => {
    const ctx = new Context()
    try {
      const locale = new LocaleRuntime(ctx, undefined, { languages: ['zh-CN'], preference: 'en' })
      expect(locale.getSnapshot().active).toBe('en')
      locale.register('native-test', 'en', {})
      expect(locale.getSnapshot().active).toBe('en')
      locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' })
      expect(locale.getSnapshot().active).toBe('en')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps an external preference pending until its language registers', async () => {
    const ctx = new Context()
    try {
      const locale = new LocaleRuntime(ctx, undefined, { languages: ['zh-CN'], preference: 'ja' })
      expect(locale.getSnapshot().active).toBe('zh')
      const remove = locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' })
      expect(locale.getSnapshot().active).toBe('ja')
      remove()
      expect(locale.getSnapshot().active).toBe('zh')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('validates the preload response before reading its fields', () => {
    expect(parseLocaleBootstrap({ languages: ['en-US'], preference: null })).toEqual({ languages: ['en-US'], preference: null })
    expect(parseLocaleBootstrap({ languages: [], preference: 'zh' }).preference).toBe('zh')
    for (const value of [null, {}, { languages: 'en', preference: null }, { languages: [42], preference: null }, { languages: [], preference: 42 }]) {
      expect(() => parseLocaleBootstrap(value)).toThrow('invalid native initialization data')
    }
  })
})
