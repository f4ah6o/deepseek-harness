/** Reject new assertions to unknown while retiring the recorded existing assertions. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const baselinePath = 'scripts/no-unknown-casts.baseline.json'

/** Existing assertion counts, keyed by repository path and syntax fingerprint. */
export type UnknownCastBaseline = Record<string, Record<string, number>>

/** One direct assertion to unknown in authored source. */
export interface UnknownCast {
  /** Repository-relative path with forward slashes. */
  file: string
  /** One-based source line. */
  line: number
  /** SHA-256 of the ordered TypeScript AST after syntax-only formatting normalization. */
  fingerprint: string
}

function isStrictDirective(statement: ts.ExpressionStatement, source: ts.SourceFile): boolean {
  const parent = statement.parent
  const functionParent = ts.isBlock(parent) && ts.isFunctionLike(parent.parent) ? parent.parent : undefined
  const hasFunctionBody = functionParent !== undefined && 'body' in functionParent && functionParent.body === parent
  const statements = ts.isSourceFile(parent) || (ts.isBlock(parent) && hasFunctionBody) ? parent.statements : undefined
  if (statements === undefined) return false

  for (const candidate of statements) {
    if (candidate === statement) {
      const expression = statement.expression
      if (!ts.isStringLiteral(expression) || expression.text !== 'use strict') return false
      const raw = expression.getText(source)
      return !raw.slice(1, -1).includes('\\')
    }
    if (!ts.isExpressionStatement(candidate) || !ts.isStringLiteral(candidate.expression)) return false
  }
  return false
}

function numericLiteralValue(node: ts.NumericLiteral): string {
  const value = Number(node.text)
  if (Number.isNaN(value)) return `unparsed:${node.text}`
  if (value === Number.POSITIVE_INFINITY) return 'positive-infinity'
  if (value === Number.NEGATIVE_INFINITY) return 'negative-infinity'
  return String(value)
}

function structuralSyntax(node: ts.Node, source: ts.SourceFile): unknown {
  if (ts.isJSDoc(node)) return undefined
  if (ts.isParenthesizedExpression(node)) return structuralSyntax(node.expression, source)
  if (ts.isParenthesizedTypeNode(node)) return structuralSyntax(node.type, source)
  if (ts.isIdentifier(node)) return ['name', node.text]
  if (ts.isStringLiteral(node)) return ['literal', ts.SyntaxKind[node.kind], node.text]
  if (ts.isNoSubstitutionTemplateLiteral(node)) return ['literal', ts.SyntaxKind[node.kind], node.getText(source)]
  if (ts.isNumericLiteral(node)) return ['literal', ts.SyntaxKind[node.kind], numericLiteralValue(node)]
  if (ts.isBigIntLiteral(node)) return ['literal', ts.SyntaxKind[node.kind], BigInt(node.text.slice(0, -1)).toString()]
  if (ts.isToken(node)) return ['token', ts.SyntaxKind[node.kind], node.getText(source)]

  const children: unknown[] = []
  ts.forEachChild(
    node,
    (child) => {
      if (!ts.isJSDoc(child)) children.push(structuralSyntax(child, source))
      return undefined
    },
    (nodes) => {
      children.push({ nodeArray: nodes.filter((child) => !ts.isJSDoc(child)).map((child) => structuralSyntax(child, source)) })
      return undefined
    },
  )
  const strictDirective = ts.isExpressionStatement(node) && isStrictDirective(node, source)
  return ['node', ts.SyntaxKind[node.kind], (node.flags & ts.NodeFlags.OptionalChain) !== 0, strictDirective, children]
}

function syntaxFingerprint(node: ts.Node, source: ts.SourceFile): string {
  return createHash('sha256')
    .update(JSON.stringify(structuralSyntax(node, source)))
    .digest('hex')
}

function assertsUnknown(type: ts.TypeNode): boolean {
  if (ts.isParenthesizedTypeNode(type)) return assertsUnknown(type.type)
  return type.kind === ts.SyntaxKind.UnknownKeyword || (ts.isUnionTypeNode(type) && type.types.some(assertsUnknown))
}

/**
 * Find assertions to unknown, including angle syntax and unknown members of asserted unions.
 * @param file - repository-relative source path; its extension selects TS or TSX parsing.
 * @param text - source contents.
 * @returns assertions in AST traversal order; comments, strings, aliases and unknown containers do not match.
 */
export function findUnknownCasts(file: string, text: string): UnknownCast[] {
  const normalized = file.replaceAll('\\', '/')
  const source = ts.createSourceFile(normalized, text, ts.ScriptTarget.Latest, true)
  const casts: UnknownCast[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      if (assertsUnknown(node.type)) {
        casts.push({
          file: normalized,
          line: source.getLineAndCharacterOfPosition(node.type.getStart(source)).line + 1,
          fingerprint: syntaxFingerprint(node, source),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return casts
}

function isSource(file: string): boolean {
  return /\.(?:[cm]?[jt]s|[jt]sx)$/u.test(file) && !file.startsWith('vendor/') && !file.startsWith('.agents/notes/archived/')
}

/**
 * Scan tracked source and non-ignored new source, including tests and configuration files.
 * @param repoRoot - repository root containing the Git index.
 * @returns every direct unknown assertion in the current working tree.
 * @throws if discovery omits a required source area or an eligible path is a symlink.
 */
export function scanUnknownCasts(repoRoot: string): UnknownCast[] {
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      })
        .split('\0')
        .map((file) => file.replaceAll('\\', '/'))
        .filter(isSource),
    ),
  ].sort()
  const present = files.filter((file) => {
    const stat = lstatSync(resolve(repoRoot, file), { throwIfNoEntry: false })
    if (stat?.isSymbolicLink()) throw new Error(`verify-no-unknown-casts: source symlink is unsupported: ${file}`)
    return stat?.isFile() === true
  })
  for (const area of ['packages/', 'apps/', 'scripts/']) {
    if (!present.some((file) => file.startsWith(area))) {
      throw new Error(`verify-no-unknown-casts: source discovery omitted ${area}`)
    }
  }
  return present.flatMap((file) => findUnknownCasts(file, readFileSync(resolve(repoRoot, file), 'utf8')))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBaseline(repoRoot: string): UnknownCastBaseline {
  const value: unknown = JSON.parse(readFileSync(resolve(repoRoot, baselinePath), 'utf8'))
  if (!isRecord(value)) throw new Error('verify-no-unknown-casts: baseline must be a file-to-counts object')
  const baseline: UnknownCastBaseline = {}
  for (const [file, counts] of Object.entries(value)) {
    if (
      !isSource(file) ||
      file.startsWith('/') ||
      file.includes('\\') ||
      file.split('/').includes('..') ||
      !isRecord(counts) ||
      Object.keys(counts).length === 0
    ) {
      throw new Error(`verify-no-unknown-casts: invalid baseline file: ${file}`)
    }
    const parsed: Record<string, number> = {}
    for (const [fingerprint, count] of Object.entries(counts)) {
      if (!/^[a-f0-9]{64}$/u.test(fingerprint) || typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
        throw new Error(`verify-no-unknown-casts: invalid baseline count: ${file}:${fingerprint}`)
      }
      parsed[fingerprint] = count
    }
    baseline[file] = parsed
  }
  return baseline
}

/**
 * Count exact assertions without granting a file-wide allowance.
 * @param casts - observed assertions.
 * @returns path and fingerprint counts in stable order for comparison and pruning.
 */
export function countUnknownCasts(casts: readonly UnknownCast[]): UnknownCastBaseline {
  const baseline: UnknownCastBaseline = {}
  for (const { file, fingerprint } of casts) {
    const counts = (baseline[file] ??= {})
    counts[fingerprint] = (counts[fingerprint] ?? 0) + 1
  }
  return Object.fromEntries(
    Object.entries(baseline)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, counts]) => [file, Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))]),
  )
}

/**
 * Enforce the recorded assertion inventory, optionally deleting retired allowances.
 * @param repoRoot - repository root to scan.
 * @param prune - remove stale entries only after establishing that no new assertion exists.
 * @returns the number of existing assertions still present.
 * @throws for new assertions, malformed inventories, or stale entries without pruning.
 */
export function verifyNoUnknownCasts(repoRoot: string, prune = false): number {
  const baseline = readBaseline(repoRoot)
  const casts = scanUnknownCasts(repoRoot)
  const current = countUnknownCasts(casts)
  const remaining = structuredClone(baseline)
  const added: UnknownCast[] = []
  for (const cast of casts) {
    const counts = remaining[cast.file]
    const allowance = counts?.[cast.fingerprint] ?? 0
    if (counts !== undefined && allowance > 0) counts[cast.fingerprint] = allowance - 1
    else added.push(cast)
  }
  if (added.length > 0) {
    throw new Error(
      'verify-no-unknown-casts: new assertions to unknown are forbidden. Use a typed value or narrow the input.\n' +
        added.map((cast) => `  ${cast.file}:${String(cast.line)} (${cast.fingerprint})`).join('\n'),
    )
  }
  const stale = Object.entries(remaining).flatMap(([file, counts]) =>
    Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([fingerprint]) => `  ${file} (${fingerprint})`),
  )
  if (stale.length > 0) {
    if (!prune) {
      throw new Error(
        'verify-no-unknown-casts: remove retired baseline entries with pnpm run verify-no-unknown-casts --prune.\n' + stale.join('\n'),
      )
    }
    writeFileSync(resolve(repoRoot, baselinePath), `${JSON.stringify(current, null, 2)}\n`)
  }
  return casts.length
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  try {
    const args = process.argv.slice(2)
    if (args.length > 1 || (args.length === 1 && args[0] !== '--prune')) {
      throw new Error('Usage: pnpm run verify-no-unknown-casts [--prune]')
    }
    const count = verifyNoUnknownCasts(root, args[0] === '--prune')
    console.log(`verify-no-unknown-casts: no new assertions; ${String(count)} existing assertions remain.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
