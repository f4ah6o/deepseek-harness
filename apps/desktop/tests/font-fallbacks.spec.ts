import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

const welcomeCss = readFileSync(new URL('../renderer/welcome.css', import.meta.url), 'utf8')
const updateCss = readFileSync(new URL('../renderer/update-dialog.css', import.meta.url), 'utf8')
const mandatoryCss = readFileSync(new URL('../renderer/mandatory-update.css', import.meta.url), 'utf8')
const mandatoryHtml = readFileSync(new URL('../renderer/mandatory-update.html', import.meta.url), 'utf8')

function declaration(css: string, name: string): string {
  const start = css.indexOf(`${name}:`)
  if (start === -1) return ''
  const end = css.indexOf(';', start)
  return css.slice(start + name.length + 1, end).trim()
}

function expectFamilyOrder(stack: string, families: string[]): void {
  const indexes = families.map((family) => stack.indexOf(family))
  expect(indexes.every((index) => index >= 0)).toBe(true)
  expect(indexes).toEqual([...indexes].sort((left, right) => left - right))
}

describe('desktop renderer font fallbacks', () => {
  it('keeps Latin UI fonts first and Japanese families before the Chinese update-dialog fallback', () => {
    expectFamilyOrder(declaration(welcomeCss, '--dsw-font-family'), [
      '-apple-system',
      'BlinkMacSystemFont',
      "'Segoe UI'",
      "'Hiragino Sans'",
      "'Yu Gothic UI'",
      "'Yu Gothic'",
      'Meiryo',
      "'Noto Sans CJK JP'",
      'sans-serif',
    ])
    expectFamilyOrder(declaration(updateCss, 'font-family'), [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      '"Hiragino Sans"',
      '"Yu Gothic UI"',
      '"Yu Gothic"',
      'Meiryo',
      '"Noto Sans CJK JP"',
      '"Microsoft YaHei"',
    ])
  })

  it('uses Japanese monospace fallbacks for update details and the mandatory-update address', () => {
    expectFamilyOrder(declaration(updateCss, '--dsh-font-family-code'), [
      "'SF Mono'",
      "'JetBrains Mono'",
      "'Fira Code'",
      'Consolas',
      "'Liberation Mono'",
      'Menlo',
      'Courier',
      "'Osaka-Mono'",
      "'MS Gothic'",
      "'Noto Sans Mono CJK JP'",
      "'PingFang SC'",
      "'Microsoft YaHei'",
    ])
    expect(updateCss).toContain('font: 12px/18px var(--dsh-font-family-code);')
    expect(mandatoryCss).toContain('font: 12px/20px var(--dsh-font-family-code);')
    const updateDialogLink = mandatoryHtml.indexOf('href="update-dialog.css"')
    const mandatoryUpdateLink = mandatoryHtml.indexOf('href="mandatory-update.css"')
    expect(updateDialogLink).toBeGreaterThanOrEqual(0)
    expect(mandatoryUpdateLink).toBeGreaterThan(updateDialogLink)
  })
})
