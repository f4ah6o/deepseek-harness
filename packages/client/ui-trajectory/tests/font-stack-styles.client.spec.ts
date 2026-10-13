import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

const css = readFileSync(new URL('../src/client/TrajectoryTable.module.css', import.meta.url), 'utf8')

describe('trajectory font stacks', () => {
  it('uses the shared code stack for tool-call labels', () => {
    const rule = /\.toolCallNameTypeface\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/font:\s*400 12px\/18px var\(--ds-font-family-code\)/)
  })
})
