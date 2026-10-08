/** One-time opt-in migration for the fork's DeepSeek Session-log contributor. */

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, Scalar, visit } from 'yaml'
import type { Node } from 'yaml'

const MIGRATION_KEY = 'f4ah6o/deepseek-harness/session-log-upload-default-off'
const MIGRATION_VERSION = 1
const PROFILE_MARKERS_FILENAME = '.dsh-profile-migrations.json'
const HOME_MARKERS_FILENAME = '.dsh-home-migrations.json'
const LEGACY_SETTINGS_FILENAME = 'settings.yaml'
const SESSION_LOG_ENTRY_ID = 'session-log-deepseek'
const YAML_JS_TAG = 'tag:yaml.org,2002:js'
const YAML_CUSTOM_TAGS = [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }]

/** A validated set of migration versions stored by one persistent owner. */
type MigrationMarkers = Record<string, number>

/** Validate the marker file without accepting a shape that a future write could damage. */
function isMigrationMarkers(value: unknown): value is MigrationMarkers {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.entries(value).every(([key, version]) => key.length > 0
      && typeof version === 'number' && Number.isSafeInteger(version) && version > 0)
}

/** Read one fork-owned marker map; malformed or unreadable state fails startup. */
async function readMarkers(path: string): Promise<MigrationMarkers> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`dsh: cannot read migration marker ${path}`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`dsh: migration marker ${path} is not valid JSON`)
  }
  if (!isMigrationMarkers(value)) throw new Error(`dsh: migration marker ${path} has an invalid format`)
  return value
}

/** Return an atomic marker map with this fork's migration version recorded. */
async function writeMarker(path: string, markers: MigrationMarkers): Promise<void> {
  const next = { ...markers, [MIGRATION_KEY]: MIGRATION_VERSION }
  await writeFileAtomic(path, JSON.stringify(next, undefined, 2) + '\n', { mode: 0o600 })
}

/** Read a YAML document and fail without echoing source text that may hold user settings. */
async function readYamlDocument(path: string): Promise<ReturnType<typeof parseDocument> | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`dsh: cannot read ${path} for the Session-log upload migration`)
  }
  const document = parseDocument(text, { customTags: YAML_CUSTOM_TAGS })
  if (document.errors.length > 0) {
    throw new Error(`dsh: cannot migrate Session-log upload settings because ${path} is invalid YAML`)
  }
  return document
}

/** Resolve YAML aliases without evaluating custom JavaScript-tagged scalars. */
function resolveNode(
  document: ReturnType<typeof parseDocument>,
  node: Node | null | undefined,
  path: string,
): Node | undefined {
  let current = node ?? undefined
  const seen = new Set<Node>()
  while (current !== undefined && isAlias(current)) {
    if (seen.has(current)) throw new Error(`dsh: cannot inspect cyclic YAML alias at ${path}`)
    seen.add(current)
    const resolved = current.resolve(document)
    if (resolved === undefined) throw new Error(`dsh: cannot inspect unresolved YAML alias at ${path}`)
    current = resolved
  }
  return current
}

/** Copy a node without anchors so a migrated entry cannot change other anchor consumers. */
function cloneWithoutAnchors(node: Node, path: string): Node {
  const clone = node.clone()
  if (!isNode(clone)) throw new Error(`dsh: cannot safely copy aliased YAML at ${path}`)
  visit(clone, {
    Node(_key, child) {
      if (!isAlias(child) && 'anchor' in child) delete child.anchor
    },
  })
  return clone
}

/** Keep comments attached to the target occurrence when replacing an alias. */
function copyComments(source: Node, target: Node): void {
  if (source.comment === undefined) delete target.comment
  else target.comment = source.comment
  if (source.commentBefore === undefined) delete target.commentBefore
  else target.commentBefore = source.commentBefore
  if (source.spaceBefore === undefined) delete target.spaceBefore
  else target.spaceBefore = source.spaceBefore
}

/** Replace every alias to a node before changing its anchored source value. */
function detachAliasConsumers(
  document: ReturnType<typeof parseDocument>,
  target: Node,
  path: string,
): void {
  visit(document, {
    Alias(_key, alias, ancestry) {
      if (alias.resolve(document) !== target) return
      if (ancestry.includes(target)) {
        throw new Error(`dsh: cannot safely migrate cyclic YAML anchor at ${path}`)
      }
      const replacement = cloneWithoutAnchors(target, path)
      copyComments(alias, replacement)
      return replacement
    },
  })
}

/** Materialize an aliased collection at one row before editing its contents. */
function materializeCollection(
  document: ReturnType<typeof parseDocument>,
  row: import('yaml').YAMLMap,
  key: string,
  kind: 'map' | 'sequence',
  path: string,
): import('yaml').YAMLMap | import('yaml').YAMLSeq | undefined {
  const raw = row.get(key, true)
  if (raw === undefined) return undefined
  const resolved = resolveNode(document, raw, `${path}.${key}`)
  if (resolved === undefined) return undefined
  if (kind === 'map' && !isMap(resolved)) return undefined
  if (kind === 'sequence' && !isSeq(resolved)) return undefined
  if (isAlias(raw)) {
    const clone = cloneWithoutAnchors(resolved, `${path}.${key}`)
    copyComments(raw, clone)
    row.set(key, clone)
    return isMap(clone) || isSeq(clone) ? clone : undefined
  }
  return isMap(resolved) || isSeq(resolved) ? resolved : undefined
}

/** Read a literal scalar through aliases without interpreting JavaScript tags. */
function scalarValue(
  document: ReturnType<typeof parseDocument>,
  row: import('yaml').YAMLMap,
  key: string,
  path: string,
): string | number | boolean | null | undefined {
  const raw = row.get(key, true)
  const resolved = resolveNode(document, raw, `${path}.${key}`)
  if (!isScalar(resolved)) return undefined
  const value = resolved.value
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined
}

/** Return a literal false scalar without evaluating an aliased JavaScript expression. */
function falseScalar(source: Node): Node {
  const scalar = new Scalar(false)
  copyComments(source, scalar)
  return scalar
}

/** Reset one known uploader row without changing values shared through YAML anchors. */
function migrateUploaderRow(
  document: ReturnType<typeof parseDocument>,
  row: import('yaml').YAMLMap,
  path: string,
  remove: boolean,
): boolean {
  const rawConfig = row.get('config', true)
  if (rawConfig === undefined) return false
  const configNode = resolveNode(document, rawConfig, `${path}.config`)
  if (configNode === undefined) return false
  if (isScalar(configNode) && configNode.tag === YAML_JS_TAG) {
    throw new Error(`dsh: cannot safely inspect the Session-log config expression at ${path}.config; replace it with a YAML map`)
  }
  if (!isMap(configNode)) return false
  if (!isAlias(rawConfig) && configNode.anchor !== undefined) {
    detachAliasConsumers(document, configNode, `${path}.config`)
  }
  const config = materializeCollection(document, row, 'config', 'map', path)
  if (config === undefined || !isMap(config)) return false
  const rawEnabled = config.get('enabled', true)
  if (rawEnabled === undefined) return false
  const enabled = resolveNode(document, rawEnabled, `${path}.config.enabled`)
  if (enabled === undefined || !isScalar(enabled)) return false
  const value = enabled.value
  const enabledIsTrue = enabled.tag === YAML_JS_TAG || value === true
  if (!enabledIsTrue) return false
  if (remove) {
    if (!isAlias(rawEnabled) && enabled.anchor !== undefined) {
      detachAliasConsumers(document, enabled, `${path}.config.enabled`)
    }
    config.delete('enabled')
    if (config.items.length === 0) row.delete('config')
    return true
  }
  if (isAlias(rawEnabled)) {
    const replacement = falseScalar(enabled)
    copyComments(rawEnabled, replacement)
    config.set('enabled', replacement)
  } else {
    if (enabled.anchor !== undefined) detachAliasConsumers(document, enabled, `${path}.config.enabled`)
    enabled.value = false
    if (enabled.tag === YAML_JS_TAG) delete enabled.tag
  }
  return true
}

/** Visit an entry sequence, including literal `insert` patches and Cordis groups. */
function migrateEntrySequence(
  document: ReturnType<typeof parseDocument>,
  sequence: import('yaml').YAMLSeq,
  path: string,
  remove: boolean,
  ancestors: readonly Node[],
): boolean {
  let changed = false
  for (const [index, rawRow] of sequence.items.entries()) {
    const rowPath = `${path}[${index}]`
    if (!isNode(rawRow)) continue
    const resolvedRow = resolveNode(document, rawRow, rowPath)
    if (!isMap(resolvedRow)) continue
    const id = scalarValue(document, resolvedRow, 'id', rowPath)
    let row = resolvedRow
    const hasKnownChildren = resolvedRow.has('insert') || scalarValue(document, resolvedRow, 'group', rowPath) === true
    if (isAlias(rawRow) && (id === SESSION_LOG_ENTRY_ID || hasKnownChildren)) {
      row = cloneWithoutAnchors(resolvedRow, rowPath) as import('yaml').YAMLMap
      copyComments(rawRow, row)
      sequence.items[index] = row
    }
    if (id === SESSION_LOG_ENTRY_ID) changed = migrateUploaderRow(document, row, rowPath, remove) || changed

    if (row.has('insert')) {
      const insertNode = resolveNode(document, row.get('insert', true), `${rowPath}.insert`)
      if (insertNode === undefined) continue
      if (isScalar(insertNode) && insertNode.tag === YAML_JS_TAG) {
        throw new Error(`dsh: cannot safely inspect dynamic Cordis insert at ${rowPath}.insert; replace it with a YAML sequence`)
      }
      if (!isSeq(insertNode)) {
        throw new Error(`dsh: cannot safely inspect Cordis insert at ${rowPath}.insert; replace it with a YAML sequence`)
      }
      if (ancestors.includes(insertNode)) {
        throw new Error(`dsh: cannot safely migrate cyclic Cordis entry sequence at ${rowPath}.insert`)
      }
      const inserts = materializeCollection(document, row, 'insert', 'sequence', rowPath)
      if (inserts !== undefined && isSeq(inserts)) {
        changed = migrateEntrySequence(document, inserts, `${rowPath}.insert`, remove, [...ancestors, insertNode]) || changed
      }
    }

    if (scalarValue(document, row, 'group', rowPath) === true) {
      const groupConfig = resolveNode(document, row.get('config', true), `${rowPath}.config`)
      if (groupConfig !== undefined && isScalar(groupConfig) && groupConfig.tag === YAML_JS_TAG) {
        throw new Error(`dsh: cannot safely inspect dynamic Cordis group at ${rowPath}.config; replace it with a YAML sequence`)
      }
      if (isSeq(groupConfig)) {
        if (ancestors.includes(groupConfig)) {
          throw new Error(`dsh: cannot safely migrate cyclic Cordis group at ${rowPath}.config`)
        }
        const groupRows = materializeCollection(document, row, 'config', 'sequence', rowPath)
        if (groupRows !== undefined && isSeq(groupRows)) {
          changed = migrateEntrySequence(document, groupRows, `${rowPath}.config`, remove, [...ancestors, groupConfig]) || changed
        }
      }
    }
  }
  return changed
}

/** Reset saved uploader enablement in Cordis profile, home, and inserted entry rows. */
async function migratePatch(path: string, remove: boolean): Promise<string | undefined> {
  const document = await readYamlDocument(path)
  if (document === undefined) return undefined
  if (!isSeq(document.contents)) throw new Error(`dsh: cannot migrate Session-log upload settings because ${path} is not a YAML sequence`)
  const changed = migrateEntrySequence(document, document.contents, 'cordis.patch.yml', remove, [document.contents])
  return changed ? String(document) : undefined
}

/** Reset saved uploader enablement in the legacy Session-log settings section. */
async function migrateLegacySettings(path: string): Promise<string | undefined> {
  const document = await readYamlDocument(path)
  if (document === undefined || !isMap(document.contents)) return undefined
  const rawSection = document.contents.get(SESSION_LOG_ENTRY_ID, true)
  if (rawSection === undefined) return undefined
  const sectionNode = resolveNode(document, rawSection, `settings.yaml.${SESSION_LOG_ENTRY_ID}`)
  if (sectionNode === undefined) return undefined
  if (isScalar(sectionNode) && sectionNode.tag === YAML_JS_TAG) {
    throw new Error(`dsh: cannot safely inspect the Session-log settings expression at settings.yaml.${SESSION_LOG_ENTRY_ID}; replace it with a YAML map`)
  }
  if (!isMap(sectionNode)) return undefined
  let section = sectionNode
  if (isAlias(rawSection)) {
    section = cloneWithoutAnchors(sectionNode, `settings.yaml.${SESSION_LOG_ENTRY_ID}`) as import('yaml').YAMLMap
    copyComments(rawSection, section)
    document.contents.set(SESSION_LOG_ENTRY_ID, section)
  } else if (sectionNode.anchor !== undefined) {
    detachAliasConsumers(document, sectionNode, `settings.yaml.${SESSION_LOG_ENTRY_ID}`)
  }
  const rawEnabled = section.get('enabled', true)
  const enabled = resolveNode(document, rawEnabled, `settings.yaml.${SESSION_LOG_ENTRY_ID}.enabled`)
  if (enabled === undefined || !isScalar(enabled)) return undefined
  const enabledIsTrue = enabled.tag === YAML_JS_TAG || enabled.value === true
  if (!enabledIsTrue) return undefined
  if (isAlias(rawEnabled)) {
    const replacement = falseScalar(enabled)
    copyComments(rawEnabled, replacement)
    section.set('enabled', replacement)
  } else {
    if (enabled.anchor !== undefined) detachAliasConsumers(document, enabled, `settings.yaml.${SESSION_LOG_ENTRY_ID}.enabled`)
    enabled.value = false
    if (enabled.tag === YAML_JS_TAG) delete enabled.tag
  }
  return String(document)
}

/** Read and atomically commit a changed YAML file while its owner lock is held. */
async function commitYaml(path: string, contents: string | undefined): Promise<void> {
  if (contents !== undefined) await writeFileAtomic(path, contents, { mode: 0o600 })
}

/** Reset prior upload opt-ins in one profile and in the shared Harness home exactly once.
 * @param profileDir - profile directory owning its user patch and completion marker.
 * @param profilePatchPath - profile `cordis.patch.yml` file.
 * @param home - shared Harness home owning the home patch, legacy settings, and completion marker.
 * @param homePatchPath - shared home `cordis.patch.yml` file and lock path.
 * @returns Fulfillment after YAML edits and both completion markers commit.
 * @throws when either lock, marker, YAML parse, or atomic write fails.
 */
export async function migrateSessionLogUploadDefaults(
  profileDir: string,
  profilePatchPath: string,
  home: string,
  homePatchPath: string,
): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 })
  const profileManifestPath = join(profileDir, 'package.json')
  if (!existsSync(profileManifestPath)) {
    throw new Error(`dsh: cannot migrate Session-log upload settings before the profile manifest exists at ${profileManifestPath}`)
  }
  const profileMarkersPath = join(profileDir, PROFILE_MARKERS_FILENAME)
  const homeMarkersPath = join(home, HOME_MARKERS_FILENAME)
  await withFileLock(profileManifestPath, async () => {
    const profileMarkers = await readMarkers(profileMarkersPath)
    const profileVersion = profileMarkers[MIGRATION_KEY]
    const profileDone = profileVersion !== undefined && profileVersion >= MIGRATION_VERSION
    await withFileLock(homePatchPath, async () => {
      const homeMarkers = await readMarkers(homeMarkersPath)
      const homeVersion = homeMarkers[MIGRATION_KEY]
      const homeDone = homeVersion !== undefined && homeVersion >= MIGRATION_VERSION
      const nextProfile = profileDone ? undefined : await migratePatch(profilePatchPath, false)
      const nextHome = homeDone ? undefined : await migratePatch(homePatchPath, true)
      const nextLegacy = homeDone ? undefined : await migrateLegacySettings(join(home, LEGACY_SETTINGS_FILENAME))
      await commitYaml(profilePatchPath, nextProfile)
      await commitYaml(homePatchPath, nextHome)
      await commitYaml(join(home, LEGACY_SETTINGS_FILENAME), nextLegacy)
      if (!profileDone) await writeMarker(profileMarkersPath, profileMarkers)
      if (!homeDone) await writeMarker(homeMarkersPath, homeMarkers)
    }, { waitMs: 120_000 })
  }, { waitMs: 120_000 })
}
