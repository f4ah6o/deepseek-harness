import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const vpCli = fileURLToPath(new URL('../node_modules/vite-plus/bin/vp', import.meta.url))
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024 * 1024
const FIX_FLAGS = new Set(['--fix', '--fix-dangerously', '--fix-suggestions'])
const STAGED_FLAG = '--staged'

function isFixInvocation(args: readonly string[]): boolean {
  return args.some((arg) => FIX_FLAGS.has(arg))
}

function hasOutputFormat(args: readonly string[]): boolean {
  return args.some((arg) => arg === '-f' || arg.startsWith('-f=') || arg === '--format' || arg.startsWith('--format='))
}

/** Complete Vite+ lint child-process arguments and environment. */
export interface VitePlusLintInvocation {
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/**
 * Apply the repository worker bound and optional staged profile to Vite+ lint.
 * @param args - Vite+ lint arguments requested by the caller.
 * @param env - Environment inherited by the linter process.
 * @returns the complete Vite+ CLI arguments and child environment.
 */
export function resolveVitePlusLintInvocation(args: readonly string[], env: NodeJS.ProcessEnv): VitePlusLintInvocation {
  const stagedFlags = args.filter((arg) => arg === STAGED_FLAG).length
  if (stagedFlags > 1) throw new Error('run-vp-lint: pass --staged at most once.')
  const lintArgs = args.filter((arg) => arg !== STAGED_FLAG)
  const profile = stagedFlags === 1 ? 'staged' : env.DSH_LINT_PROFILE
  if (profile !== undefined && profile !== 'staged') {
    throw new Error(`run-vp-lint: DSH_LINT_PROFILE must be 'staged' or unset, got ${JSON.stringify(profile)}.`)
  }
  const childEnv = { ...env }
  if (profile === 'staged') childEnv.DSH_LINT_PROFILE = 'staged'
  else delete childEnv.DSH_LINT_PROFILE

  const resolvedArgs = ['lint', ...lintArgs]
  if (env.CI === 'true' && !hasOutputFormat(lintArgs)) resolvedArgs.push('--format=default')
  const raw = env.DSH_OXLINT_THREADS
  if (raw === undefined || raw === '') return { args: resolvedArgs, env: childEnv }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`run-vp-lint: DSH_OXLINT_THREADS must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  if (lintArgs.some((arg) => arg === '--threads' || arg.startsWith('--threads='))) {
    throw new Error('run-vp-lint: use DSH_OXLINT_THREADS instead of passing --threads directly.')
  }
  return {
    args: [...resolvedArgs, `--threads=${raw}`],
    env: { ...childEnv, GOMAXPROCS: raw },
  }
}

function completeFrom(result: { readonly signal: NodeJS.Signals | null; readonly status: number | null }): void {
  if (result.signal !== null) {
    process.kill(process.pid, result.signal)
    return
  }
  process.exitCode = result.status ?? 1
}

function main(): void {
  const invocation = resolveVitePlusLintInvocation(process.argv.slice(2), process.env)
  if (!isFixInvocation(invocation.args)) {
    const result = spawnSync(process.execPath, [vpCli, ...invocation.args], {
      env: invocation.env,
      stdio: 'inherit',
    })
    if (result.error !== undefined) throw result.error
    completeFrom(result)
    return
  }

  const first = spawnSync(process.execPath, [vpCli, ...invocation.args], {
    encoding: 'utf8',
    env: invocation.env,
    maxBuffer: MAX_CAPTURED_OUTPUT_BYTES,
  })
  if (first.error !== undefined) throw first.error
  if (first.signal !== null) {
    completeFrom(first)
    return
  }
  if (first.status === 0) {
    process.stdout.write(first.stdout)
    process.stderr.write(first.stderr)
    process.exitCode = 0
    return
  }

  // Overlapping JS-plugin fixes can expose one more fixable diagnostic after the first pass.
  const second = spawnSync(process.execPath, [vpCli, ...invocation.args], {
    env: invocation.env,
    stdio: 'inherit',
  })
  if (second.error !== undefined) throw second.error
  completeFrom(second)
}

const entrypoint = process.argv[1]
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) main()
