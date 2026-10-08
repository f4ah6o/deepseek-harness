/** Process-spawning cases keep the repository lint contracts under the real Vite+ CLI. */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

interface ViteToolchainConfig {
  lint?: { options?: Record<string, unknown> }
  fmt?: Record<string, unknown>
}

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const configPath = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
const { default: viteConfig } = (await import(configPath)) as { default: ViteToolchainConfig }
const vpCli = fileURLToPath(new URL('../node_modules/vite-plus/bin/vp', import.meta.url))
const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))

function runVpLint(args: readonly string[], env: NodeJS.ProcessEnv = {}, cwd = repositoryRoot) {
  return spawnSync(process.execPath, [vpCli, 'lint', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
}

function runRepositoryLint(args: readonly string[], env: NodeJS.ProcessEnv = {}, cwd = repositoryRoot) {
  return spawnSync(process.execPath, [tsxCli, join('scripts', 'run-vp-lint.ts'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
}

function normalizedOutput(result: ReturnType<typeof runVpLint>): string {
  return `${result.stdout}${result.stderr}`.replaceAll('\\', '/')
}

/** Create a disposable repo-shaped tree so generated package source never races repo-wide scanners. */
async function createLintFixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-vite-plus-lint-fixture-'))
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  const packageOverlays = new Set([
    join('client', 'ui-primitives', 'src'),
    join('client', 'ui-trajectory', 'tests'),
    join('core', 'session', 'src'),
    join('core', 'session', 'tests'),
    join('fs', 'fs-observation-policy', 'src'),
    join('fs', 'fs-observation-policy', 'tests'),
  ])
  const appOverlays = new Set([join('cli', 'tests', 'profiles', 'headless', 'tests')])

  async function copyTree(source: string, target: string): Promise<void> {
    await mkdir(target, { recursive: true })
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)
      if (entry.isDirectory()) await copyTree(sourcePath, targetPath)
      else if (entry.isFile()) await copyFile(sourcePath, targetPath)
    }
  }

  async function mirrorWithOverlays(source: string, target: string, overlays: ReadonlySet<string>, prefix = ''): Promise<void> {
    await mkdir(target, { recursive: true })
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)
      const relativePath = prefix === '' ? entry.name : join(prefix, entry.name)
      const exactOverlay = overlays.has(relativePath)
      const hasNestedOverlay = [...overlays].some((overlay) => overlay.startsWith(`${relativePath}${sep}`))

      if (exactOverlay && entry.isDirectory()) await copyTree(sourcePath, targetPath)
      else if (hasNestedOverlay && entry.isDirectory()) {
        await mirrorWithOverlays(sourcePath, targetPath, overlays, relativePath)
      } else if (entry.isDirectory()) await symlink(sourcePath, targetPath, linkType)
      else if (entry.isFile()) await copyFile(sourcePath, targetPath)
    }
  }

  async function mirrorDirectoryContents(source: string, target: string): Promise<void> {
    await mkdir(target, { recursive: true })
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)
      if (entry.isDirectory()) await symlink(sourcePath, targetPath, linkType)
      else if (entry.isFile()) await copyFile(sourcePath, targetPath)
    }
  }

  try {
    for (const name of [
      'package.json',
      'vite.config.ts',
      'tsconfig.json',
      'tsconfig.host.json',
      'tsconfig.client.json',
      'tsconfig.base.json',
      'tsconfig.base.client.json',
      '.gitignore',
    ]) {
      await copyFile(join(repositoryRoot, name), join(root, name))
    }
    await mirrorWithOverlays(join(repositoryRoot, 'packages'), join(root, 'packages'), packageOverlays)
    await mirrorWithOverlays(join(repositoryRoot, 'apps'), join(root, 'apps'), appOverlays)
    await mirrorDirectoryContents(join(repositoryRoot, 'scripts'), join(root, 'scripts'))
    await mirrorDirectoryContents(join(repositoryRoot, 'examples'), join(root, 'examples'))
    const rootEntries = await readdir(repositoryRoot, { withFileTypes: true })
    for (const entry of rootEntries) {
      const name = entry.name
      if (['.git', 'apps', 'examples', 'node_modules', 'packages', 'scripts'].includes(name)) continue
      const sourcePath = join(repositoryRoot, name)
      const targetPath = join(root, name)
      if (entry.isDirectory()) await symlink(sourcePath, targetPath, linkType)
      else if (entry.isFile()) await copyFile(sourcePath, targetPath)
    }
    await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), linkType)
    return root
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

describe('Vite+ lint contract', () => {
  it('discovers the owning TypeScript project for every source and test face', { timeout: 90_000 }, async () => {
    const suffix = randomUUID()
    const fixtureRoot = await createLintFixtureRoot()
    const probes = [
      ['host package source', 'packages/fs/fs-observation-policy/src', 'packages/fs/fs-observation-policy/tsconfig.json'],
      ['host package test', 'packages/fs/fs-observation-policy/tests', 'tsconfig.host.json'],
      ['client package source', 'packages/client/ui-primitives/src', 'packages/client/ui-primitives/tsconfig.json'],
      ['client package test', 'packages/client/ui-trajectory/tests', 'tsconfig.client.json', '.client.ts'],
      ['CLI profile test', 'apps/cli/tests/profiles/headless/tests', 'tsconfig.host.json'],
    ] as const
    const source = `export function probePromise(): Promise<void> {
  return Promise.resolve()
}

probePromise()
`

    try {
      const paths: Array<readonly [label: string, path: string, tsconfig: string]> = []
      for (const [label, parent, tsconfig, extension = '.ts'] of probes) {
        const path = join(fixtureRoot, parent, `vp-lint-contract-${suffix}${extension}`)
        await mkdir(join(fixtureRoot, parent), { recursive: true })
        await writeFile(path, source)
        paths.push([label, relative(fixtureRoot, path), tsconfig])
      }
      const clientScript = 'scripts/client-bundle-purity.spec.ts'
      await mkdir(join(fixtureRoot, 'scripts'), { recursive: true })
      await writeFile(join(fixtureRoot, clientScript), '')
      const result = runVpLint(['--format', 'unix', ...paths.map(([, path]) => path), clientScript], { OXC_LOG: 'debug' }, fixtureRoot)
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(1)
      for (const [label, path, tsconfig] of paths) {
        expect(output, label).toContain(`${path}:5:1: Promises must be awaited`)
        expect(output, `${label} project`).toContain(
          `Got tsconfig for file ${join(fixtureRoot, path).replaceAll('\\', '/')}: ${join(fixtureRoot, tsconfig).replaceAll('\\', '/')}`,
        )
      }
      expect(output.match(/typescript\(no-floating-promises\)/g)).toHaveLength(probes.length)
      expect(output, 'client aggregate script project').toContain(
        `Got tsconfig for file ${join(fixtureRoot, clientScript).replaceAll('\\', '/')}: ${join(fixtureRoot, 'tsconfig.client.json').replaceAll('\\', '/')}`,
      )
      expect(output).not.toContain('Unmatched file:')
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('retains type-aware, SonarJS, and stylistic rules in the root config', { timeout: 90_000 }, async () => {
    const suffix = randomUUID()
    const fixtureRoot = await createLintFixtureRoot()
    const path = join(fixtureRoot, 'scripts', `vp-lint-contract-${suffix}.ts`)
    const source = `export function firstProbe(): number {
  const first = 1
  const second = 2
  return first + second
}

export function secondProbe(): number {
  const first = 1
  const second = 2
  return first + second
}

export function hasValue(value: string): boolean {
  return value !== undefined
}

export const longProbe = ${'1 + '.repeat(40)}1
`

    try {
      await writeFile(path, source)
      const result = runVpLint(['--format', 'unix', relative(fixtureRoot, path)], {}, fixtureRoot)
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(1)
      expect(output).toContain('@stylistic(max-len)')
      expect(output).toContain('sonarjs(no-identical-functions)')
      expect(output).toContain('typescript(no-unnecessary-condition)')
      expect(viteConfig.lint?.options).toMatchObject({ typeAware: true, typeCheck: false })
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('keeps the formatter aligned with the stylistic policy and bounded paths', () => {
    expect(viteConfig.fmt).toMatchObject({
      ignorePatterns: [
        '**/*.md',
        '.agents/notes/archived/**',
        'vendor/**',
        '**/fixtures/**',
        '**/lib/**',
        '**/dist/**',
        'packages/workflow/workflow-ptc/src/guest-source.ts',
        'packages/extensions/cordis-client-runner/src/client/api-catalog.ts',
        'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts',
        'packages/extensions/tool-cordis/src/api-catalog.ts',
      ],
      singleQuote: true,
      semi: false,
      tabWidth: 2,
      printWidth: 140,
      trailingComma: 'all',
      arrowParens: 'always',
    })
    const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(packageJson.scripts['lint:contracts-ready']).toBe('tsx scripts/run-vp-lint.ts .')
    expect(packageJson.scripts['lint:fix:contracts-ready']).toBe(
      'tsx scripts/run-vp-lint.ts --staged packages/typert/generator/tests/fixtures/type-model --fix && tsx scripts/run-vp-lint.ts . --fix',
    )
    expect(packageJson.devDependencies).not.toHaveProperty('oxlint')
    expect(packageJson.devDependencies).not.toHaveProperty('oxlint-tsgolint')
    expect(existsSync(join(repositoryRoot, '.oxlintrc.json'))).toBe(false)
    expect(existsSync(join(repositoryRoot, '.oxlintrc.staged.json'))).toBe(false)

    const lefthook = readFileSync(join(repositoryRoot, 'lefthook.yml'), 'utf8')
    expect(lefthook).toContain('vp fmt --write --no-error-on-unmatched-pattern {staged_files}')
    expect(lefthook).toContain('scripts/run-vp-lint.ts --staged --fix --no-error-on-unmatched-pattern {staged_files}')
    expect(lefthook).toContain("'**/fixtures/**'")
  })

  it('keeps staged lint project-free while preserving style validation', { timeout: 90_000 }, async () => {
    const suffix = randomUUID()
    const fixtureRoot = await createLintFixtureRoot()
    const path = join(fixtureRoot, 'scripts', `vp-lint-contract-${suffix}.ts`)

    try {
      await writeFile(path, 'export const value={answer:1};\n')
      const lint = runRepositoryLint(['--staged', '--format', 'unix', relative(fixtureRoot, path)], {}, fixtureRoot)
      const output = normalizedOutput(lint)

      expect(lint.error).toBeUndefined()
      expect(lint.status, output).toBe(1)
      expect(output).toContain('@stylistic')
      expect(output).not.toContain('typescript(')
      expect(output).not.toContain('Got tsconfig')
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('continues staged lint when generated files are ignored', { timeout: 90_000 }, async () => {
    const suffix = randomUUID()
    const fixtureRoot = await createLintFixtureRoot()
    const generatedRoot = join(fixtureRoot, 'packages/fs/fs-observation-policy', `vp-lint-contract-${suffix}`)
    const generated = join(generatedRoot, 'lib', 'generated.ts')
    const source = join(fixtureRoot, 'scripts', `vp-lint-contract-${suffix}.ts`)

    try {
      expect(existsSync(join(generatedRoot, 'lib'))).toBe(false)
      await mkdir(join(generatedRoot, 'lib'), { recursive: true })
      await writeFile(generated, 'export const generated = 1\n')
      const generatedOnly = runRepositoryLint(
        ['--staged', '--format', 'unix', '--no-error-on-unmatched-pattern', relative(fixtureRoot, generated)],
        {},
        fixtureRoot,
      )
      const generatedOutput = normalizedOutput(generatedOnly)

      expect(generatedOnly.error).toBeUndefined()
      expect(generatedOnly.status, generatedOutput).toBe(0)

      await writeFile(source, 'export const value={answer:1};\n')
      const mixed = runRepositoryLint(
        [
          '--staged',
          '--format',
          'unix',
          '--no-error-on-unmatched-pattern',
          relative(fixtureRoot, generated),
          relative(fixtureRoot, source),
        ],
        {},
        fixtureRoot,
      )
      const mixedOutput = normalizedOutput(mixed)

      expect(mixed.error).toBeUndefined()
      expect(mixed.status, mixedOutput).toBe(1)
      expect(mixedOutput).toContain('@stylistic')
      expect(mixedOutput).not.toContain('typescript(')
      expect(mixedOutput).not.toContain('Got tsconfig')
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('reports unused suppressions through the Vite+ executable', { timeout: 90_000 }, async () => {
    const suffix = randomUUID()
    const fixtureRoot = await createLintFixtureRoot()
    const path = join(fixtureRoot, 'scripts', `vp-lint-contract-${suffix}.ts`)

    try {
      await writeFile(path, '// oxlint-disable-next-line no-console\nexport const value = 1\n')
      const result = runVpLint(['--format', 'unix', relative(fixtureRoot, path)], {}, fixtureRoot)
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(0)
      expect(output).toContain('Unused oxlint-disable directive')
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('retries overlapping fixes and reports only remaining diagnostics', { timeout: 90_000 }, async () => {
    const suffix = randomUUID()
    const fixtureRoot = await createLintFixtureRoot()
    const path = join(fixtureRoot, 'scripts', `vp-lint-contract-${suffix}.ts`)

    try {
      await writeFile(path, `export const longProbe = ${'1 + '.repeat(80)}1\n`)
      const result = runRepositoryLint(['--staged', '--format', 'unix', '--fix', relative(fixtureRoot, path)], {}, fixtureRoot)
      const output = normalizedOutput(result)

      expect(result.error).toBeUndefined()
      expect(result.status, output).toBe(1)
      expect(output.match(/@stylistic\(max-len\)/g)).toHaveLength(1)
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('keeps the reviewed Session history exception in the active linter config', { timeout: 90_000 }, async () => {
    const suffix = randomUUID()
    const fixtureRoot = await createLintFixtureRoot()
    const exampleRoot = `examples/vp-lint-contract-${suffix}`
    const examplePath = `${exampleRoot}/tests/reads.ts`
    const testPaths = [
      `packages/core/session/tests/vp-lint-contract-${suffix}.ts`,
      `apps/cli/tests/vp-lint-contract-${suffix}.ts`,
      examplePath,
      `scripts/vp-lint-contract-${suffix}.spec.ts`,
    ]
    const sourcePaths = [`packages/core/session/src/vp-lint-contract-${suffix}.ts`, `scripts/vp-lint-contract-${suffix}.ts`]
    const paths = [...testPaths, ...sourcePaths]
    const reads = `import { Session, SessionSeq } from '@deepseek-ai/dsh-session'

export function reads(session: Session): void {
  session.snapshotEvents()
  session.eventAt(SessionSeq(0))
  session.ownEvents()
}
`
    const existing = `import { Session, SessionSeq } from '@deepseek-ai/dsh-session'

export function reads(session: Session): void {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  session.snapshotEvents()
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  session.eventAt(SessionSeq(0))
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  session.ownEvents()
}
`
    const unrelated = `
/** @deprecated Use the replacement API. */
function oldApi(): void {}

export function unrelatedRead(): void {
  oldApi()
}
`

    try {
      await mkdir(join(fixtureRoot, exampleRoot, 'tests'), { recursive: true })
      await writeFile(
        join(fixtureRoot, exampleRoot, 'tsconfig.json'),
        JSON.stringify({
          extends: '../../tsconfig.base.json',
          include: ['tests/**/*.ts'],
        }),
      )
      await Promise.all(paths.map((path) => mkdir(dirname(join(fixtureRoot, path)), { recursive: true })))
      await Promise.all([
        ...testPaths.map((path) => writeFile(join(fixtureRoot, path), reads)),
        ...sourcePaths.map((path) => writeFile(join(fixtureRoot, path), existing)),
      ])
      const allowed = runRepositoryLint(['--format', 'unix', ...paths], {}, fixtureRoot)
      expect(allowed.error).toBeUndefined()
      expect(allowed.signal).toBeNull()
      expect(allowed.status, normalizedOutput(allowed)).toBe(0)

      await Promise.all([
        ...testPaths.map((path) => writeFile(join(fixtureRoot, path), reads + unrelated)),
        ...sourcePaths.map((path) => writeFile(join(fixtureRoot, path), reads)),
      ])
      const rejected = runRepositoryLint(['--format', 'unix', ...paths], {}, fixtureRoot)
      const output = normalizedOutput(rejected)
      expect(rejected.error).toBeUndefined()
      expect(rejected.signal).toBeNull()
      expect(rejected.status, output).toBe(1)
      const diagnostics = output.split('\n').filter((line) => /:\d+:\d+: `\w+` is deprecated\./.test(line))
      for (const path of testPaths) {
        const reported = diagnostics.filter((line) => line.startsWith(`${path}:`))
        expect(reported, output).toHaveLength(1)
        expect(reported[0]).toContain('`oldApi` is deprecated')
      }
      for (const path of sourcePaths) {
        expect(
          diagnostics.filter((line) => line.startsWith(`${path}:`)),
          output,
        ).toHaveLength(3)
      }
      for (const method of ['snapshotEvents', 'eventAt', 'ownEvents', 'oldApi']) {
        expect(output).toContain('`' + method + '` is deprecated')
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})
