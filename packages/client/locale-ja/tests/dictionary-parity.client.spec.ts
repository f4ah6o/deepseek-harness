/** Keep each Japanese namespace and its interpolation variables aligned with its English and Chinese owner dictionaries. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vite-plus/test'
import { DICTIONARIES } from '../src/client/dicts/index.ts'

interface SourceDictionary {
  readonly values: ReadonlyMap<string, string>
  readonly file: string
}

interface ImportTarget {
  readonly file: string
  readonly name: string
}

interface SourceScope {
  readonly file: string
  readonly source: ts.SourceFile
  readonly values: ReadonlyMap<string, ts.Expression>
  readonly imports: ReadonlyMap<string, ImportTarget>
}

const root = resolve(import.meta.dirname, '../../../..')
const dictionaryDirectory = resolve(import.meta.dirname, '../src/client/dicts')

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) {
    return unwrap(expression.expression)
  }
  return expression
}

function sourceScope(file: string): SourceScope {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const values = new Map<string, ts.Expression>()
  const imports = new Map<string, ImportTarget>()

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      values.set(node.name.text, node.initializer)
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings
      if (bindings !== undefined && ts.isNamedImports(bindings) && node.moduleSpecifier.text.startsWith('.')) {
        const target = resolveImport(file, node.moduleSpecifier.text)
        if (target !== undefined) {
          for (const element of bindings.elements) {
            imports.set(element.name.text, { file: target, name: element.propertyName?.text ?? element.name.text })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { file, source, values, imports }
}

function resolveImport(owner: string, specifier: string): string | undefined {
  const target = resolve(dirname(owner), specifier)
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, resolve(target, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function expressionText(expression: ts.Expression, scope: SourceScope, visited: ReadonlySet<string> = new Set()): string | undefined {
  const value = unwrap(expression)
  if (ts.isStringLiteralLike(value)) return value.text
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = expressionText(value.left, scope, visited)
    const right = expressionText(value.right, scope, visited)
    return left === undefined || right === undefined ? undefined : left + right
  }
  if (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.name.text === 'join' &&
    ts.isArrayLiteralExpression(value.expression.expression)
  ) {
    const parts = value.expression.expression.elements.map((element) =>
      ts.isExpression(element) ? expressionText(element, scope, visited) : undefined,
    )
    if (!parts.every((part): part is string => part !== undefined)) return undefined
    const separator = value.arguments[0] === undefined ? ',' : expressionText(value.arguments[0], scope, visited)
    return separator === undefined ? undefined : parts.join(separator)
  }
  if (!ts.isIdentifier(value)) return undefined

  const local = scope.values.get(value.text)
  if (local !== undefined) {
    const reference = `${scope.file}#${value.text}`
    if (visited.has(reference)) return undefined
    return expressionText(local, scope, new Set([...visited, reference]))
  }
  const imported = scope.imports.get(value.text)
  if (imported === undefined) return undefined
  const reference = `${imported.file}#${imported.name}`
  if (visited.has(reference)) return undefined
  const targetScope = sourceScope(imported.file)
  const targetValue = targetScope.values.get(imported.name)
  return targetValue === undefined ? undefined : expressionText(targetValue, targetScope, new Set([...visited, reference]))
}

function expressionDictionary(
  expression: ts.Expression,
  scope: SourceScope,
  visited: ReadonlySet<string> = new Set(),
): Map<string, string> | undefined {
  const value = unwrap(expression)
  if (ts.isIdentifier(value)) {
    const local = scope.values.get(value.text)
    if (local !== undefined) {
      const reference = `${scope.file}#${value.text}`
      if (visited.has(reference)) return undefined
      return expressionDictionary(local, scope, new Set([...visited, reference]))
    }
    const imported = scope.imports.get(value.text)
    if (imported !== undefined) {
      const reference = `${imported.file}#${imported.name}`
      if (visited.has(reference)) return undefined
      const targetScope = sourceScope(imported.file)
      const targetValue = targetScope.values.get(imported.name)
      if (targetValue !== undefined) {
        return expressionDictionary(targetValue, targetScope, new Set([...visited, reference]))
      }
    }
    return undefined
  }
  if (!ts.isObjectLiteralExpression(value)) return undefined

  const dictionary = new Map<string, string>()
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = expressionDictionary(property.expression, scope, visited)
      if (spread === undefined) return undefined
      for (const [key, text] of spread) dictionary.set(key, text)
      continue
    }
    if (!ts.isPropertyAssignment(property)) continue
    const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : undefined
    if (key === undefined) continue
    const text = expressionText(property.initializer, scope, visited)
    if (text === undefined) return undefined
    dictionary.set(key, text)
  }
  return dictionary
}

function sourceDictionaries(file: string): SourceDictionary[] {
  const candidates = new Set([file])
  if (basename(file) === 'zh.ts') candidates.add(resolve(dirname(file), 'en.ts'))
  const dictionaries: SourceDictionary[] = []

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const scope = sourceScope(candidate)
    function visit(node: ts.Node): void {
      if (ts.isObjectLiteralExpression(node)) {
        const values = expressionDictionary(node, scope)
        if (values !== undefined) dictionaries.push({ values, file: candidate })
      }
      ts.forEachChild(node, visit)
    }
    visit(scope.source)
  }
  return dictionaries
}

function placeholderNames(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/gu)].map((match) => match[1] ?? '').sort()
}

function ownerPathFor(dictionaryFile: string): string {
  const text = readFileSync(resolve(dictionaryDirectory, dictionaryFile), 'utf8')
  const owner = text.match(/^\/\*\* Japanese dictionary for the `[^`]+` namespace \(([^)]+)\)\. \*\//mu)?.[1]
  if (owner === undefined) throw new Error(`${dictionaryFile}: missing owner source path in its header`)
  return resolve(root, 'packages', owner)
}

/** Locale namespaces declared by every client package shipped in the Web bundle. */
function activeNamespaceDeclarations(): string[] {
  const dependencies = new Set<string>()
  for (const bundle of ['base', 'web-app']) {
    const manifest = JSON.parse(readFileSync(resolve(root, `packages/bundle/${bundle}/package.json`), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    for (const name of Object.keys(manifest.dependencies ?? {})) dependencies.add(name)
  }
  const clientRoot = resolve(root, 'packages')
  const namespaces = new Set<string>()

  for (const group of readdirSync(clientRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const groupPath = resolve(clientRoot, group.name)
    for (const packageEntry of readdirSync(groupPath, { withFileTypes: true })) {
      if (!packageEntry.isDirectory()) continue
      const packageRoot = resolve(groupPath, packageEntry.name)
      const packageManifestPath = resolve(packageRoot, 'package.json')
      if (!existsSync(packageManifestPath)) continue
      const packageManifest = JSON.parse(readFileSync(packageManifestPath, 'utf8')) as { name?: string }
      if (packageManifest.name === undefined || !dependencies.has(packageManifest.name)) continue
      const sourceRoot = resolve(packageRoot, 'src/client')
      if (!existsSync(sourceRoot)) continue

      const visitDirectory = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name)
          if (entry.isDirectory()) {
            visitDirectory(path)
            continue
          }
          if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue
          const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
          const scope = sourceScope(path)
          function visit(node: ts.Node): void {
            if (ts.isInterfaceDeclaration(node) && node.name.text === 'LocaleNamespaceMap') {
              for (const member of node.members) {
                if (!ts.isPropertySignature(member) || member.name === undefined) continue
                if (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)) {
                  namespaces.add(member.name.text)
                }
              }
            }
            if (
              ts.isCallExpression(node) &&
              ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === 'register' &&
              ts.isPropertyAccessExpression(node.expression.expression) &&
              node.expression.expression.name.text === 'locale'
            ) {
              const namespace = node.arguments[0] === undefined ? undefined : expressionText(node.arguments[0], scope)
              if (namespace !== undefined) namespaces.add(namespace)
            }
            ts.forEachChild(node, visit)
          }
          visit(source)
        }
      }
      visitDirectory(sourceRoot)
    }
  }
  return [...namespaces].sort()
}

describe('Japanese locale dictionaries', () => {
  it('covers every registered namespace once', () => {
    const names = DICTIONARIES.map((entry) => entry.ns)
    expect(new Set(names).size).toBe(names.length)
    const files = readdirSync(dictionaryDirectory).filter((file) => file.endsWith('.ts') && file !== 'index.ts')
    const declared = new Map<string, string>()
    for (const file of files) {
      const text = readFileSync(resolve(dictionaryDirectory, file), 'utf8')
      const namespace = text.match(/^\/\*\* Japanese dictionary for the `([^`]+)` namespace/mu)?.[1]
      if (namespace !== undefined) declared.set(namespace, file)
    }
    expect([...declared.keys()].sort()).toEqual(names.sort())
    const active = activeNamespaceDeclarations()
    expect(active.filter((namespace) => !names.includes(namespace))).toEqual([])
  })

  it('matches every owning English and Chinese key and interpolation set', () => {
    const files = new Map<string, string>()
    for (const file of readdirSync(dictionaryDirectory).filter((path) => path.endsWith('.ts') && path !== 'index.ts')) {
      const text = readFileSync(resolve(dictionaryDirectory, file), 'utf8')
      const namespace = text.match(/^\/\*\* Japanese dictionary for the `([^`]+)` namespace/mu)?.[1]
      if (namespace !== undefined) files.set(namespace, file)
    }

    for (const entry of DICTIONARIES) {
      const file = files.get(entry.ns)
      if (file === undefined) throw new Error(`${entry.ns}: Japanese dictionary source file is missing`)
      const owner = ownerPathFor(file)
      const expectedKeys = Object.keys(entry.dict).sort()
      const candidates = sourceDictionaries(owner).filter(
        (dictionary) => JSON.stringify([...dictionary.values.keys()].sort()) === JSON.stringify(expectedKeys),
      )
      if (candidates.length < 2) {
        const available = sourceDictionaries(owner)
        const sizes = available.map((dictionary) => `${dictionary.file}:${dictionary.values.size}`).join(', ')
        const closest = available[0]
        const missing = closest === undefined ? [] : expectedKeys.filter((key) => !closest.values.has(key))
        const extra = closest === undefined ? [] : [...closest.values.keys()].filter((key) => !expectedKeys.includes(key))
        throw new Error(
          `${entry.ns}: could not find matching English and Chinese dictionaries in ${owner}; expected ${expectedKeys.length}, found ${sizes}, missing ${missing}, extra ${extra}`,
        )
      }

      for (const candidate of candidates) {
        for (const key of expectedKeys) {
          const expected = placeholderNames(entry.dict[key] ?? '')
          const actual = placeholderNames(candidate.values.get(key) ?? '')
          expect(actual, `${entry.ns}.${key} placeholders in ${candidate.file}`).toEqual(expected)
        }
      }
    }
  })
})
