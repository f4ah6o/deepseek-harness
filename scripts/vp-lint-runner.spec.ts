import { describe, expect, it } from 'vite-plus/test'
import { resolveVitePlusLintInvocation } from './run-vp-lint.ts'

describe('Vite+ lint invocation', () => {
  it('preserves the ordinary default invocation', () => {
    expect(resolveVitePlusLintInvocation(['.'], { PATH: '/bin' })).toEqual({
      args: ['lint', '.'],
      env: { PATH: '/bin' },
    })
  })

  it('bounds both worker pools from one setting', () => {
    expect(resolveVitePlusLintInvocation(['.', '--fix'], { DSH_OXLINT_THREADS: '4', GOMAXPROCS: '12' })).toEqual({
      args: ['lint', '.', '--fix', '--threads=4'],
      env: { DSH_OXLINT_THREADS: '4', GOMAXPROCS: '4' },
    })
  })

  it('uses location-preserving diagnostics in CI', () => {
    expect(resolveVitePlusLintInvocation(['.'], { CI: 'true', DSH_OXLINT_THREADS: '4' })).toEqual({
      args: ['lint', '.', '--format=default', '--threads=4'],
      env: { CI: 'true', DSH_OXLINT_THREADS: '4', GOMAXPROCS: '4' },
    })
  })

  it('preserves an explicitly selected CI formatter', () => {
    expect(resolveVitePlusLintInvocation(['.', '--format', 'github'], { CI: 'true' }).args).toEqual(['lint', '.', '--format', 'github'])
  })

  it('activates the type-check-free profile only when requested', () => {
    expect(resolveVitePlusLintInvocation(['--staged', 'scripts'], { DSH_LINT_PROFILE: undefined })).toEqual({
      args: ['lint', 'scripts'],
      env: { DSH_LINT_PROFILE: 'staged' },
    })
    expect(resolveVitePlusLintInvocation(['scripts'], { DSH_LINT_PROFILE: 'staged' }).env).toEqual({ DSH_LINT_PROFILE: 'staged' })
  })

  it('rejects invalid staged profile settings', () => {
    expect(() => resolveVitePlusLintInvocation(['scripts'], { DSH_LINT_PROFILE: 'fast' })).toThrow(
      "DSH_LINT_PROFILE must be 'staged' or unset",
    )
    expect(() => resolveVitePlusLintInvocation(['--staged', '--staged'], {})).toThrow('pass --staged at most once')
  })

  it.each(['0', '-1', '1.5', 'auto'])('rejects invalid worker bound %s', (value) => {
    expect(() => resolveVitePlusLintInvocation(['.'], { DSH_OXLINT_THREADS: value })).toThrow(
      'DSH_OXLINT_THREADS must be a positive integer',
    )
  })

  it('rejects a competing direct worker bound', () => {
    expect(() => resolveVitePlusLintInvocation(['.', '--threads=2'], { DSH_OXLINT_THREADS: '4' })).toThrow('use DSH_OXLINT_THREADS instead')
  })
})
