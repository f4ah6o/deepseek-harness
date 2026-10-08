import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { countUnknownCasts, findUnknownCasts, scanUnknownCasts, verifyNoUnknownCasts } from './verify-no-unknown-casts.ts'

const roots: string[] = []
const baselinePath = 'scripts/no-unknown-casts.baseline.json'
const sourcePath = 'packages/example/src/index.ts'
const assertion = 'const result = value as unknown\n'

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(root: string, file: string, contents: string): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' })
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-unknown-casts-'))
  roots.push(root)
  git(root, 'init', '--quiet')
  for (const area of ['packages', 'apps', 'scripts']) {
    write(root, `${area}/seed.ts`, 'export {}\n')
  }
  write(root, baselinePath, '{}\n')
  git(root, 'add', '.')
  return root
}

function recordBaseline(root: string): string {
  const text = `${JSON.stringify(countUnknownCasts(scanUnknownCasts(root)), null, 2)}\n`
  write(root, baselinePath, text)
  return text
}

describe('unknown assertion syntax', () => {
  it.each([
    ['standalone', 'input.ts', 'value as unknown', 1],
    ['double assertion', 'input.ts', 'value as unknown as Result', 1],
    ['nested assertions', 'input.ts', '(value as unknown) as unknown', 2],
    ['multiline', 'input.ts', 'value as\nunknown', 1],
    ['comment-separated', 'input.ts', 'value as /* explanation */ unknown', 1],
    ['parenthesized type', 'input.ts', 'value as ((unknown))', 1],
    ['angle assertion', 'input.ts', '<unknown>value', 1],
    ['parenthesized angle type', 'input.ts', '<(unknown)>value', 1],
    ['union', 'input.ts', 'value as unknown | string', 1],
    ['union with trailing unknown', 'input.ts', 'value as string | unknown', 1],
    ['parenthesized union', 'input.ts', 'value as (unknown | never)', 1],
    ['nested union', 'input.ts', 'value as string | (unknown | number)', 1],
    ['angle union assertion', 'input.ts', '<unknown | string>value', 1],
    ['escaped keyword', 'input.ts', String.raw`value as \u0075nknown`, 1],
    ['TSX expression', 'input.tsx', '<View value={input as unknown} />', 1],
    ['template interpolation', 'input.ts', '`text ${value as unknown}`', 1],
  ])('finds %s', (_name, file, text, count) => {
    expect(findUnknownCasts(file, text)).toHaveLength(count)
  })

  it.each([
    '// value as unknown\n/* <unknown>value */',
    'const text = "value as unknown"',
    'const text = `value as unknown`',
    'const result = value as unknown[]',
    'const result = value as Record<string, unknown>',
    'const result = value as unknown[] | string',
    'const result = value as unknown & { id: string }',
    'const result = value as string | (unknown & { id: string })',
    'const result = <unknown[]>value',
    'const result: unknown = value',
    'type Input = unknown; const result = value as Input',
    'type Input = unknown; const result = value as Input | string',
  ])('accepts source without a direct assertion: %s', (text) => {
    expect(findUnknownCasts('input.ts', text)).toEqual([])
  })

  it('accepts JSX text without ignoring assertions in expressions', () => {
    expect(findUnknownCasts('input.tsx', '<View>as unknown</View>')).toEqual([])
    expect(findUnknownCasts('input.tsx', '<View>{value as unknown}</View>')).toHaveLength(1)
  })

  it('excludes JavaScript JSDoc assertions', () => {
    expect(findUnknownCasts('input.js', 'const result = /** @type {unknown} */ (value)')).toEqual([])
  })

  it('reports normalized paths and the asserted type line', () => {
    const casts = findUnknownCasts('packages\\example\\index.ts', '\nvalue as\nunknown')
    expect(casts).toHaveLength(1)
    expect(casts[0]).toMatchObject({ file: 'packages/example/index.ts', line: 3 })
    expect(casts[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('keeps structural fingerprints through whitespace, comments, and formatter-only syntax', () => {
    const original = findUnknownCasts('input.ts', 'call(value, "text") as unknown')
    const formatted = findUnknownCasts('input.ts', '\ncall /* call */ (value,\n "text") as /* type */ unknown')
    expect(formatted.map((cast) => cast.fingerprint)).toEqual(original.map((cast) => cast.fingerprint))
    const documented = findUnknownCasts('input.ts', 'call(/** @type {number} */ value, "text") as unknown')
    expect(documented.map((cast) => cast.fingerprint)).toEqual(original.map((cast) => cast.fingerprint))
    const beforeFormat = findUnknownCasts('input.ts', 'call(value => value) as unknown')
    const afterFormat = findUnknownCasts('input.ts', 'call((value) => value,) as unknown')
    expect(afterFormat.map((cast) => cast.fingerprint)).toEqual(beforeFormat.map((cast) => cast.fingerprint))
    const beforeParenthesizing = findUnknownCasts('input.ts', 'const result = await import("module") as unknown')
    const afterParenthesizing = findUnknownCasts('input.ts', 'const result = (await import("module")) as unknown')
    expect(afterParenthesizing.map((cast) => cast.fingerprint)).toEqual(beforeParenthesizing.map((cast) => cast.fingerprint))
    const beforeObjectParens = findUnknownCasts('input.ts', 'const result = { value } as unknown')
    const afterObjectParens = findUnknownCasts('input.ts', 'const result = ({ value }) as unknown')
    expect(afterObjectParens.map((cast) => cast.fingerprint)).toEqual(beforeObjectParens.map((cast) => cast.fingerprint))
    const beforeTernaryParens = findUnknownCasts('input.ts', 'const result = { value: enabled ? value : undefined } as unknown')
    const afterTernaryParens = findUnknownCasts('input.ts', 'const result = { value: (enabled ? value : undefined) } as unknown')
    expect(afterTernaryParens.map((cast) => cast.fingerprint)).toEqual(beforeTernaryParens.map((cast) => cast.fingerprint))
    const trailingListComma = findUnknownCasts('input.ts', 'call(value,) as unknown')
    const plainList = findUnknownCasts('input.ts', 'call(value) as unknown')
    expect(trailingListComma.map((cast) => cast.fingerprint)).toEqual(plainList.map((cast) => cast.fingerprint))
    expect(findUnknownCasts('input.ts', 'call(((value))) as unknown').map((cast) => cast.fingerprint)).toEqual(
      plainList.map((cast) => cast.fingerprint),
    )
    expect(findUnknownCasts('input.ts', 'call(value as (unknown))').map((cast) => cast.fingerprint)).toEqual(
      findUnknownCasts('input.ts', 'call(value as unknown)').map((cast) => cast.fingerprint),
    )
    expect(findUnknownCasts('input.ts', 'call(value, "other") as unknown').map((cast) => cast.fingerprint)).not.toEqual(
      original.map((cast) => cast.fingerprint),
    )
    expect(findUnknownCasts('input.ts', "call(value, 'text') as unknown").map((cast) => cast.fingerprint)).toEqual(
      original.map((cast) => cast.fingerprint),
    )
    const numericOriginal = findUnknownCasts('input.ts', 'call(0xFFFFFFFF) as unknown')
    const numericFormatted = findUnknownCasts('input.ts', 'call(0xffffffff,) as unknown')
    expect(numericFormatted.map((cast) => cast.fingerprint)).toEqual(numericOriginal.map((cast) => cast.fingerprint))
    expect(findUnknownCasts('input.ts', 'call(0xfffffffe) as unknown').map((cast) => cast.fingerprint)).not.toEqual(
      numericOriginal.map((cast) => cast.fingerprint),
    )
    expect(findUnknownCasts('input.ts', 'call(1e400) as unknown').map((cast) => cast.fingerprint)).not.toEqual(
      findUnknownCasts('input.ts', 'call(Infinity) as unknown').map((cast) => cast.fingerprint),
    )
    expect(findUnknownCasts('input.ts', 'call(1e401) as unknown').map((cast) => cast.fingerprint)).toEqual(
      findUnknownCasts('input.ts', 'call(1e400) as unknown').map((cast) => cast.fingerprint),
    )
  })

  it('preserves use-strict directive semantics while normalizing string values', () => {
    const direct = findUnknownCasts('input.ts', "const fn = function () { 'use strict'; return this } as unknown")
    const otherQuote = findUnknownCasts('input.ts', 'const fn = function () { "use strict"; return this } as unknown')
    const parenthesized = findUnknownCasts('input.ts', "const fn = function () { ('use strict'); return this } as unknown")
    const escaped = findUnknownCasts('input.ts', "const fn = function () { 'use\\u0020strict'; return this } as unknown")

    expect(otherQuote.map((cast) => cast.fingerprint)).toEqual(direct.map((cast) => cast.fingerprint))
    expect(parenthesized.map((cast) => cast.fingerprint)).not.toEqual(direct.map((cast) => cast.fingerprint))
    expect(escaped.map((cast) => cast.fingerprint)).not.toEqual(direct.map((cast) => cast.fingerprint))
  })

  it.each([
    ['comma expression versus arguments', 'call(value, other) as unknown', 'call((value, other)) as unknown'],
    ['grouped expression', '(value + other) as unknown', 'value + (other as unknown)'],
    ['optional chaining', 'value?.item as unknown', 'value.item as unknown'],
    ['optional-chain termination', '(object?.field).next as unknown', 'object?.field.next as unknown'],
    ['sparse array', '[value,,] as unknown', '[value] as unknown'],
  ])('preserves semantic syntax in the %s fingerprint', (_name, original, changed) => {
    expect(findUnknownCasts('input.ts', changed).map((cast) => cast.fingerprint)).not.toEqual(
      findUnknownCasts('input.ts', original).map((cast) => cast.fingerprint),
    )
  })

  it.each([
    ['value as unknown', 'b5bc89bee2416893106ded67f284d8e7d941528eb1338e8758a1df3f7a516bb0'],
    ['call() as unknown', '441909f0697df07183b394c913cebfb92fe9826e1152aa64d70be298962e353b'],
  ])('preserves the recorded fingerprint for %s', (text, fingerprint) => {
    expect(findUnknownCasts('input.ts', text)[0]?.fingerprint).toBe(fingerprint)
  })
})

describe('unknown assertion inventory', () => {
  it('accepts recorded assertions after formatting without rewriting the baseline', () => {
    const root = fixture()
    write(root, sourcePath, assertion)
    const baseline = recordBaseline(root)
    write(root, sourcePath, 'const result = value as\n /* reason */ unknown\n')
    expect(verifyNoUnknownCasts(root)).toBe(1)
    expect(verifyNoUnknownCasts(root, true)).toBe(1)
    expect(readFileSync(join(root, baselinePath), 'utf8')).toBe(baseline)
  })

  it.each([
    ['additional assertion', `${assertion}const other = input as unknown\n`],
    ['duplicate assertion', `${assertion}${assertion}`],
    ['replacement assertion', 'const result = other as unknown\n'],
    ['union assertion', 'const result = value as unknown | string\n'],
  ])('rejects an %s without changing the baseline', (_name, text) => {
    const root = fixture()
    write(root, sourcePath, assertion)
    const baseline = recordBaseline(root)
    write(root, sourcePath, text)
    expect(() => verifyNoUnknownCasts(root)).toThrow(/new assertions to unknown/u)
    expect(() => verifyNoUnknownCasts(root, true)).toThrow(/new assertions to unknown/u)
    expect(readFileSync(join(root, baselinePath), 'utf8')).toBe(baseline)
  })

  it.each([
    assertion,
    'const result = value as (unknown | never)\n',
    'const result = value as string | (unknown | number)\n',
    String.raw`const result = value as \u0075nknown`,
  ])('rejects a new assertion when the inventory is empty: %s', (text) => {
    const root = fixture()
    write(root, sourcePath, text)
    expect(() => verifyNoUnknownCasts(root)).toThrow(`${sourcePath}:1`)
  })

  it('requires pruning retired counts while preserving the remaining assertion', () => {
    const root = fixture()
    write(root, sourcePath, `${assertion}${assertion}`)
    write(root, 'apps/retired.ts', 'const retired = input as unknown\n')
    recordBaseline(root)
    write(root, sourcePath, assertion)
    unlinkSync(join(root, 'apps/retired.ts'))
    expect(() => verifyNoUnknownCasts(root)).toThrow(/remove retired baseline entries/u)
    expect(verifyNoUnknownCasts(root, true)).toBe(1)
    expect(JSON.parse(readFileSync(join(root, baselinePath), 'utf8'))).toEqual(countUnknownCasts(findUnknownCasts(sourcePath, assertion)))
    expect(verifyNoUnknownCasts(root)).toBe(1)
  })

  it('prunes a deleted tracked file without treating it as a discovery failure', () => {
    const root = fixture()
    write(root, sourcePath, assertion)
    git(root, 'add', sourcePath)
    recordBaseline(root)
    unlinkSync(join(root, sourcePath))
    expect(() => verifyNoUnknownCasts(root)).toThrow(/remove retired baseline entries/u)
    expect(verifyNoUnknownCasts(root, true)).toBe(0)
    expect(readFileSync(join(root, baselinePath), 'utf8')).toBe('{}\n')
  })

  it.each([
    ['not an object', '[]'],
    ['null', 'null'],
    ['invalid JSON', '{'],
    ['non-source path', '{"input.json":{"HASH":1}}'],
    ['absolute path', '{"/input.ts":{"HASH":1}}'],
    ['parent path', '{"../input.ts":{"HASH":1}}'],
    ['backslash path', JSON.stringify({ 'packages\\input.ts': { HASH: 1 } })],
    ['excluded path', '{"vendor/input.ts":{"HASH":1}}'],
    ['empty file counts', '{"input.ts":{}}'],
    ['array counts', '{"input.ts":[]}'],
    ['invalid fingerprint', '{"input.ts":{"invalid":1}}'],
    ['zero count', '{"input.ts":{"HASH":0}}'],
    ['negative count', '{"input.ts":{"HASH":-1}}'],
    ['fractional count', '{"input.ts":{"HASH":1.5}}'],
    ['unsafe count', '{"input.ts":{"HASH":9007199254740992}}'],
    ['string count', '{"input.ts":{"HASH":"1"}}'],
  ])('rejects a malformed baseline: %s', (_name, text) => {
    const root = fixture()
    const contents = text.replaceAll('HASH', 'a'.repeat(64))
    write(root, baselinePath, contents)
    expect(() => verifyNoUnknownCasts(root, true)).toThrow()
    expect(readFileSync(join(root, baselinePath), 'utf8')).toBe(contents)
  })
})

describe('unknown assertion source discovery', () => {
  it('checks tracked source across areas, extensions, tests and root configuration', () => {
    const root = fixture()
    const files = [
      'packages/example/src/input.ts',
      'apps/example/input.tsx',
      'scripts/input.mts',
      'packages/example/tests/input.js',
      'apps/example/input.jsx',
      'scripts/input.mjs',
      'config.ts',
    ]
    for (const file of files) write(root, file, assertion)
    git(root, 'add', '.')
    expect(scanUnknownCasts(root).map((cast) => cast.file)).toEqual(files.toSorted())
    expect(() => verifyNoUnknownCasts(root)).toThrow(/new assertions to unknown/u)
  })

  it('includes untracked source while excluding ignored files, vendor, archives and other extensions', () => {
    const root = fixture()
    write(root, '.gitignore', 'ignored/\n')
    for (const file of ['ignored/input.ts', 'vendor/input.ts', '.agents/notes/archived/input.ts', 'docs/input.md']) {
      write(root, file, assertion)
    }
    git(root, 'add', '.')
    write(root, 'scripts/new.ts', assertion)
    expect(scanUnknownCasts(root).map((cast) => cast.file)).toEqual(['scripts/new.ts'])
    expect(() => verifyNoUnknownCasts(root)).toThrow('scripts/new.ts:1')
    unlinkSync(join(root, 'scripts/new.ts'))
    expect(verifyNoUnknownCasts(root)).toBe(0)
  })

  it.each(['packages', 'apps', 'scripts'])('rejects discovery missing %s', (area) => {
    const root = fixture()
    unlinkSync(join(root, `${area}/seed.ts`))
    expect(() => verifyNoUnknownCasts(root)).toThrow(`source discovery omitted ${area}/`)
  })

  it('rejects an empty source corpus', () => {
    const root = fixture()
    for (const area of ['packages', 'apps', 'scripts']) unlinkSync(join(root, `${area}/seed.ts`))
    expect(() => verifyNoUnknownCasts(root)).toThrow(/source discovery omitted/u)
  })

  // Creating file symlinks requires privileges that Windows CI does not guarantee.
  it.skipIf(process.platform === 'win32')('rejects a source symlink', () => {
    const root = fixture()
    write(root, 'target.txt', assertion)
    const link = join(root, 'scripts/linked.ts')
    symlinkSync(join(root, 'target.txt'), link)
    try {
      expect(() => verifyNoUnknownCasts(root)).toThrow('source symlink is unsupported: scripts/linked.ts')
    } finally {
      unlinkSync(link)
    }
  })
})
