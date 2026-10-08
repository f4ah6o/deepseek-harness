/** Staged Oxfmt must tolerate ignored generated inputs without skipping regular files. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const formatterPath = join(repositoryRoot, 'node_modules/vite-plus/bin/vp')

function formatStaged(root: string, paths: string[]) {
  return spawnSync(
    process.execPath,
    [
      formatterPath,
      'fmt',
      '--write',
      '--no-error-on-unmatched-pattern',
      `--ignore-path=${join(root, '.gitignore')}`,
      ...paths.map((path) => join(root, path)),
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-staged-format-'))
  const generated = 'const generated={value:"generated"}\n'
  writeFileSync(join(root, '.gitignore'), 'generated.ts\n')
  writeFileSync(join(root, 'generated.ts'), generated)
  writeFileSync(join(root, 'regular.ts'), 'const regular={value:"regular"}\n')
  return { root, generated }
}

describe('staged Oxfmt command', () => {
  it('accepts a staged set containing only ignored generated files', () => {
    const { root, generated } = fixture()
    try {
      const result = formatStaged(root, ['generated.ts'])

      expect(result.status).toBe(0)
      expect(readFileSync(join(root, 'generated.ts'), 'utf8')).toBe(generated)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('formats ordinary staged files when ignored generated files are also staged', () => {
    const { root, generated } = fixture()
    try {
      const result = formatStaged(root, ['generated.ts', 'regular.ts'])

      expect(result.status).toBe(0)
      expect(readFileSync(join(root, 'generated.ts'), 'utf8')).toBe(generated)
      expect(readFileSync(join(root, 'regular.ts'), 'utf8')).not.toBe('const regular={value:"regular"}\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps the generated-file option in the staged hook formatter invocation', () => {
    const lefthook = readFileSync(join(repositoryRoot, 'lefthook.yml'), 'utf8')

    expect(lefthook).toMatch(/vp fmt --write --no-error-on-unmatched-pattern \{staged_files\}/)
  })
})
