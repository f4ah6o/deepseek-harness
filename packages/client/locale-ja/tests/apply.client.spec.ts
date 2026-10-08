/** locale-ja apply wiring: the language definition, every dictionary over the
 * real locale registry, English fallback for uncovered namespaces, and
 * disposal through the plugin fiber. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-locale-ja/client'
import type { LocaleSettings } from '@deepseek-ai/dsh-client-locale/src/locale-settings.ts'
import { DICTIONARIES } from '../src/client/dicts/index.ts'

async function bench(languages: readonly string[] = ['en-US'], preference: string | null = null) {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx, undefined, { languages, preference })
  ctx.provide('locale', locale)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, locale, fiber }
}

describe('locale-ja apply', () => {
  it('defaults to Japanese after its complete dictionary set is ready, regardless of system language', async () => {
    const { locale } = await bench()
    expect(locale.getSnapshot().locales.map(entry => entry.id)).toEqual(['zh', 'en', 'ja'])
    expect(locale.getSnapshot().active).toBe('ja')
    expect(locale.getSnapshot().locales.find(entry => entry.id === 'ja'))
      .toMatchObject({ label: '日本語', fallback: 'en' })
    expect(locale.bind('common')('cancel')).toBe('キャンセル')
    expect(locale.bind('settings.locale')('language.title')).toBe('言語')
    expect(locale.bind('model')('menu.provider')).toBe('プロバイダー')
    expect(locale.bind('gitBranch')('branch.aria', { ref: 'owner/repo:main' }))
      .toBe('ブランチ owner/repo:main')
    expect(locale.bind('gitBranch')('detached.aria', { ref: 'abc1234' }))
      .toBe('ブランチなしの HEAD abc1234')
    expect(locale.bind('chat')('message.turnProcess.worked')).toBe('完了')
    expect(locale.bind('chat')('message.turnProcess.took')).toBe('完了、所要時間 ')
  })

  it('keeps Japanese as the default when an English browser loads an empty Host preference', async () => {
    const ctx = new Context()
    const host = stubConfigForm<LocaleSettings>()
    const locale = new LocaleRuntime(ctx, host.scope, { languages: ['en-US'], preference: null })
    ctx.provide('locale', locale)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      expect(locale.getSnapshot().active).toBe('ja')
      host.publish({ status: 'ready', value: {}, revision: 1, writable: true })
      expect(locale.getSnapshot().active).toBe('ja')
      expect(host.set).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each(['en', 'zh'] as const)('adopts saved %s from Host after the Japanese pack registers', async (preference) => {
    const ctx = new Context()
    const host = stubConfigForm<LocaleSettings>()
    const locale = new LocaleRuntime(ctx, host.scope, { languages: ['en-US'], preference: null })
    ctx.provide('locale', locale)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      expect(locale.getSnapshot().active).toBe('ja')
      host.publish({ status: 'ready', value: { preference }, revision: 1, writable: true })
      expect(locale.getSnapshot().active).toBe(preference)
      expect(host.set).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each(['en', 'zh'] as const)('preserves the saved %s choice when Japanese registers', async (preference) => {
    const { locale } = await bench(['ja-JP'], preference)
    expect(locale.getSnapshot().active).toBe(preference)
  })

  it('falls back to English for a namespace the pack does not carry', async () => {
    const { locale } = await bench()
    locale.register('untranslated', 'en', { key: 'English copy' })
    locale.setLocale('ja')
    expect(locale.bind('untranslated')('key')).toBe('English copy')
  })

  it('ships one non-empty dictionary per namespace with no duplicate registration', () => {
    const namespaces = DICTIONARIES.map(entry => entry.ns)
    expect(new Set(namespaces).size).toBe(namespaces.length)
    for (const { ns, dict } of DICTIONARIES) {
      expect(Object.keys(dict).length, ns).toBeGreaterThan(0)
    }
    expect(namespaces).toContain('common')
    expect(namespaces).toContain('settings.theme')
  })

  it('keeps the append-only turn labels free of placeholders', () => {
    // `message.turnProcess.took` is read with no params and the caller splices
    // the duration after it, so a `{duration}` in the ja pack leaks the literal
    // braces into the rendered label.
    const chat = DICTIONARIES.find(entry => entry.ns === 'chat')?.dict as Record<string, string>
    for (const key of ['message.turnProcess.took', 'message.turnProcess.worked']) {
      expect(chat[key], key).not.toMatch(/\{[a-z]+\}/u)
    }
  })

  it('returns to the shipped pair and drops the dictionaries with its fiber', async () => {
    const { locale, fiber } = await bench()
    locale.setLocale('ja')
    expect(locale.bind('common')('cancel')).toBe('キャンセル')
    await fiber.dispose()
    expect(locale.getSnapshot().locales.map(entry => entry.id)).toEqual(['zh', 'en'])
    // Dictionary disposal: translation falls back to the bare key.
    expect(locale.bind('common')('cancel')).toBe('cancel')
  })
})
