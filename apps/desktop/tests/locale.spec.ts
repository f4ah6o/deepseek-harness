import { describe, expect, it } from 'vitest'
import { en, formatDesktopMessage, ja, resolveDesktopLocale, resolveDesktopStartupLocale, zh } from '../src/locale.ts'

describe('desktop locale dictionaries', () => {
  it('ships the same keys and interpolation placeholders in every locale', () => {
    expect(Object.keys(zh)).toEqual(Object.keys(en))
    expect(Object.keys(ja)).toEqual(Object.keys(en))
    const placeholders = (message: string): string[] => [...message.matchAll(/\{([^{}]+)\}/gu)].map(match => match[1]!).sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zh[key]), `zh.${key}`).toEqual(placeholders(en[key]))
      expect(placeholders(ja[key]), `ja.${key}`).toEqual(placeholders(en[key]))
    }
    expect(resolveDesktopLocale('zh-Hans-CN').messages).toEqual(zh)
    expect(resolveDesktopLocale('en-US').messages).toEqual(en)
    expect(resolveDesktopLocale('ja-JP').messages).toEqual(ja)
    expect(resolveDesktopLocale('ja_JP').messages).toEqual(ja)
    expect(resolveDesktopLocale('fr-FR').messages).toEqual(en)
  })

  it('formats named values without consuming unknown placeholders', () => {
    expect(formatDesktopMessage('{name}@{version} {missing}', { name: 'plugin', version: '1.2.3' }))
      .toBe('plugin@1.2.3 {missing}')
  })

  it('preserves explicit language choices and defaults to Japanese regardless of system language', () => {
    expect(resolveDesktopStartupLocale('zh', ['en-US']).id).toBe('zh-CN')
    expect(resolveDesktopStartupLocale('EN', ['zh-CN']).id).toBe('en')
    expect(resolveDesktopStartupLocale('ja', ['zh-CN']).id).toBe('ja')
    expect(resolveDesktopStartupLocale(null, ['ja-JP', 'zh-Hant', 'en-US']).id).toBe('ja')
    expect(resolveDesktopStartupLocale(null, ['en-US', 'zh-CN']).id).toBe('ja')
    expect(resolveDesktopStartupLocale(null, []).id).toBe('ja')
    expect(resolveDesktopStartupLocale('unsupported', ['zh-CN']).id).toBe('ja')
  })
})
