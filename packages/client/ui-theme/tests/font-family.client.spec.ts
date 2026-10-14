// @vitest-environment jsdom
/** Persisted font presets, bootstrap adoption, and shared CSS fallback selection. */
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, expect, it } from 'vite-plus/test'
import { ThemeRuntime } from '../src/client/index.ts'
import { bootThemeInjections } from '../src/boot-theme.ts'
import {
  DEFAULT_FONT_FAMILIES,
  FONT_ROLES,
  ThemeSettingsSchema,
  fontFamilyTokens,
  type ThemeSettings,
  type FontFamilySelections,
} from '../src/theme-settings.ts'

const base: ThemeSettings = { preference: 'system', fontSize: 14 }
const contexts: Context[] = []

function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  const host = stubConfigForm<ThemeSettings>()
  const theme = new ThemeRuntime(ctx, host.scope)
  return { ctx, host, theme }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const role of FONT_ROLES) {
    document.body.removeAttribute('data-dsh-font-' + role)
    document.body.style.removeProperty('--dsh-font-family-' + role)
  }
  document.body.style.removeProperty('--dsh-content-font-size')
  document.body.removeAttribute('data-ds-dark-theme')
  delete document.documentElement.dataset.dsThemeSource
})

it('defaults absent persisted presets and rejects unsupported choices at the settings parser', () => {
  expect(ThemeSettingsSchema(base)).toEqual({
    ...base,
    textFontFamily: 'default',
    codeFontFamily: 'default',
    terminalFontFamily: 'default',
  })
  expect(() => z.resolve({ ...base, codeFontFamily: 'meiryo' }, ThemeSettingsSchema, {})).toThrow()
  expect(() => z.resolve({ ...base, textFontFamily: 'unknown-font' }, ThemeSettingsSchema, {})).toThrow()
  expect(() => z.resolve({ ...base, terminalFontFamily: 'yu-gothic' }, ThemeSettingsSchema, {})).toThrow()
})

it('uses installed preset families before the built-in stack without changing the other roles', () => {
  expect(fontFamilyTokens({ ...DEFAULT_FONT_FAMILIES, text: 'meiryo' })).toEqual({
    '--dsh-font-family-text': 'Meiryo, var(--dsh-fallback-text-font-family)',
  })
  expect(fontFamilyTokens({ ...DEFAULT_FONT_FAMILIES, terminal: 'ms-gothic' })).toEqual({
    '--dsh-font-family-terminal': '"MS Gothic", var(--dsh-fallback-code-font-family)',
  })
  expect(fontFamilyTokens(DEFAULT_FONT_FAMILIES)).toEqual({})
  expect(() => fontFamilyTokens({ ...DEFAULT_FONT_FAMILIES, text: 'consolas' })).toThrow('unsupported font preset')
})

it('waits for accepted settings before changing the selected font and rejects cross-role choices', async () => {
  const { ctx, host, theme } = harness()
  expect(theme.getFontFamilies()).toEqual(DEFAULT_FONT_FAMILIES)
  const unchanged = theme.getTheme()
  await expect(theme.setFontFamily('text', 'meiryo')).resolves.toBe(true)
  expect(host.set).toHaveBeenCalledWith('textFontFamily', 'meiryo')
  expect(theme.getTheme()).toBe(unchanged)
  expect(() => theme.setFontFamily('code', 'meiryo')).toThrow('unsupported font preset')
  host.publish({ status: 'ready', value: { ...base, textFontFamily: 'meiryo' }, revision: 1, writable: true })
  expect(theme.getFontFamilies()).toEqual({ ...DEFAULT_FONT_FAMILIES, text: 'meiryo' })
  expect(theme.getTheme().active.tokens['--dsh-font-family-text']).toContain('Meiryo')
  host.set.mockClear()
  await expect(theme.setFontFamily('text', 'meiryo')).resolves.toBe(true)
  expect(host.set).toHaveBeenCalledWith('textFontFamily', 'meiryo')
  await ctx.fiber.dispose()
  expect(host.listenerCount()).toBe(0)
})

it('keeps the current font after a rejected settings write', async () => {
  const { ctx, host, theme } = harness()
  host.set.mockResolvedValueOnce(false)
  const before = theme.getTheme()
  await expect(theme.setFontFamily('terminal', 'consolas')).resolves.toBe(false)
  expect(theme.getTheme()).toBe(before)
  expect(theme.getFontFamilies().terminal).toBe('default')
  await ctx.fiber.dispose()
})

it('adopts code and terminal separately, preserves theme overrides, and retracts a default selection', async () => {
  const { ctx, host, theme } = harness()
  const dispose = theme.overrideTokens('test', { '--dsw-alias-label-primary': { light: 'red', dark: 'blue' } })
  host.publish({ value: { ...base, codeFontFamily: 'consolas', terminalFontFamily: 'jetbrains-mono' } })
  const snapshot = theme.getTheme()
  expect(snapshot.active.tokens['--dsh-font-family-code']).toContain('Consolas')
  expect(snapshot.active.tokens['--dsh-font-family-terminal']).toContain('JetBrains Mono')
  expect(snapshot.active.tokens['--dsw-alias-label-primary']).toBe('red')
  host.publish({ value: { ...base, codeFontFamily: 'consolas', terminalFontFamily: 'jetbrains-mono' } })
  expect(theme.getTheme()).toBe(snapshot)
  host.publish({ value: base })
  expect(theme.getFontFamilies()).toEqual(DEFAULT_FONT_FAMILIES)
  expect(theme.getTheme().active.tokens).toEqual({ '--dsw-alias-label-primary': 'red' })
  dispose()
  expect(theme.getTheme().active.tokens).toEqual({})
  await ctx.fiber.dispose()
})

it('seeds selected fonts before plugins mount and clears stale font overrides for defaults', async () => {
  const fonts: FontFamilySelections = { text: 'noto-sans-jp', code: 'ms-gothic', terminal: 'jetbrains-mono' }
  for (const row of bootThemeInjections('light', 14, fonts)) {
    if (row.kind === 'script') runInNewContext(row.text, { document })
  }
  const { ctx, theme } = harness()
  expect(theme.getFontFamilies()).toEqual(fonts)
  expect(document.body.style.getPropertyValue('--dsh-font-family-text')).toContain('Noto Sans JP')
  expect(theme.getTheme().active.tokens).toEqual(fontFamilyTokens(fonts))
  for (const row of bootThemeInjections('light')) {
    if (row.kind === 'script') runInNewContext(row.text, { document })
  }
  expect(document.body.style.getPropertyValue('--dsh-font-family-text')).toBe('')
  expect(document.body.getAttribute('data-dsh-font-terminal')).toBe('default')
  await ctx.fiber.dispose()
})

it('ignores unsupported bootstrap preset identities', async () => {
  document.body.setAttribute('data-dsh-font-text', 'not-a-font')
  document.body.setAttribute('data-dsh-font-code', 'meiryo')
  const { ctx, theme } = harness()
  expect(theme.getFontFamilies()).toEqual(DEFAULT_FONT_FAMILIES)
  await ctx.fiber.dispose()
})

it('queues a reset gesture even while the current default precedes an unfinished font write', async () => {
  const { host, theme } = harness()
  let accept!: (value: boolean) => void
  const pending = new Promise<boolean>((resolve) => {
    accept = resolve
  })
  host.set.mockReturnValueOnce(pending)
  const first = theme.setFontFamily('text', 'meiryo')
  const reset = theme.setFontFamily('text', 'default')
  expect(host.set.mock.calls).toEqual([
    ['textFontFamily', 'meiryo'],
    ['textFontFamily', 'default'],
  ])
  accept(true)
  await Promise.all([first, reset])
})
