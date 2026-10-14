import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { parseRules } from './stylesheet-scan.ts'

const css = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8')
const rules = parseRules(css)
const root = rules.find((rule) => rule.selectors.includes(':root'))
const body = rules.find((rule) => rule.selectors.includes('body'))

function value(rule: typeof root, name: string): string {
  return rule?.declarations.find(([property]) => property === name)?.[1] ?? ''
}

function expectFamilyOrder(stack: string, families: string[]): void {
  const indexes = families.map((family) => stack.indexOf(family))
  expect(indexes.every((index) => index >= 0)).toBe(true)
  expect(indexes).toEqual([...indexes].sort((left, right) => left - right))
}

describe('ui-theme font fallbacks', () => {
  it('keeps Latin UI families ahead of Japanese and Chinese system fallbacks', () => {
    expectFamilyOrder(value(root, '--dsh-fallback-text-font-family'), [
      '-apple-system',
      'BlinkMacSystemFont',
      "'Segoe UI'",
      "'Hiragino Sans'",
      "'Yu Gothic UI'",
      "'Yu Gothic'",
      'Meiryo',
      "'Noto Sans CJK JP'",
      "'PingFang SC'",
      "'Hiragino Sans GB'",
      "'Microsoft YaHei'",
    ])
  })

  it('keeps Latin monospace ahead of Japanese code fallbacks and Chinese families', () => {
    const code = value(root, '--dsh-fallback-code-font-family')
    expectFamilyOrder(code, [
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
    expect(code).not.toContain('monospace')
  })

  it('resolves the mono alias in the body scope used by active theme overrides', () => {
    expect(value(root, '--dsw-font-mono')).toBe('')
    expect(value(body, '--dsw-font-mono')).toBe('var(--ds-font-family-code)')
  })
})
