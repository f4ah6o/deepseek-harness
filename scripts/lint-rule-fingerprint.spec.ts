import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vite-plus/test'

type Rules = Record<string, unknown>

interface VitePlusLintConfig {
  readonly lint?: {
    readonly overrides?: readonly unknown[]
  }
}

interface Profile {
  readonly count: number
  readonly indexes: readonly number[]
  readonly sha256: string
}

// These fingerprints pin the active Vite+ lint overrides. Oxfmt owns indentation
// and arrow parentheses, so those two former lint rules are absent from the profiles.
const profiles = {
  source: {
    count: 87,
    indexes: [0, 1, 4, 5],
    sha256: '0f395ea83edd85c8a1d7dcb431a77096264c111d9999dfaa81d217e39b8002b8',
  },
  example: {
    count: 86,
    indexes: [0, 1, 2, 4, 5],
    sha256: '436075e7eb268c6da07a33a51a84ae9f2f2a0f4908d8a0a0130cac90032d43f5',
  },
  test: {
    count: 82,
    indexes: [0, 3, 4, 5],
    sha256: '4d202bfe7455c38fb363acf908e51ab66c86b2b1e269dfb58310802e79eeed71',
  },
} as const satisfies Record<string, Profile>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function severity(value: unknown): 0 | 1 | 2 {
  const level = isUnknownArray(value) ? value[0] : value
  if (level === 'off' || level === 0) return 0
  if (level === 'warn' || level === 'warning' || level === 1) return 1
  if (level === 'error' || level === 2) return 2
  throw new Error(`unsupported lint severity: ${JSON.stringify(level)}`)
}

function normalizedRules(rules: Rules): Rules {
  return Object.fromEntries(
    Object.entries(rules)
      .filter(([, value]) => severity(value) > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => {
        const options = isUnknownArray(value) ? value.slice(1) : []
        return [name, [severity(value), ...options]]
      }),
  )
}

function mergedRules(overrides: readonly unknown[], indexes: readonly number[]): Rules {
  const merged: Rules = {}
  for (const index of indexes) {
    const override = overrides[index]
    if (!isRecord(override) || !isRecord(override.rules)) {
      throw new Error(`vite.config.ts lint override ${index} must contain a rules object`)
    }
    Object.assign(merged, override.rules)
  }
  return normalizedRules(merged)
}

const { default: viteConfig } = (await import('../vite.config.ts')) as { default: VitePlusLintConfig }
const overrides = viteConfig.lint?.overrides
if (overrides === undefined) throw new Error('vite.config.ts must define lint.overrides')

describe('Vite+ repository rule fingerprint', () => {
  it('pins every override field', () => {
    expect(overrides).toHaveLength(9)
  })

  it.each(Object.entries(profiles))('pins the %s rule profile', (_name, profile) => {
    const rules = mergedRules(overrides, profile.indexes)
    const fingerprint = createHash('sha256').update(JSON.stringify(rules)).digest('hex')

    expect(Object.keys(rules)).toHaveLength(profile.count)
    expect(fingerprint).toBe(profile.sha256)
  })
})
