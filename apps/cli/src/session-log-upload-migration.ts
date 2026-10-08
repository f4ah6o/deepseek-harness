/** One-time opt-in migration for the fork's DeepSeek Session-log contributor. */

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMap, isSeq, parseDocument } from 'yaml'

const MIGRATION_KEY = 'f4ah6o/deepseek-harness/session-log-upload-default-off'
const MIGRATION_VERSION = 1
const PROFILE_MARKERS_FILENAME = '.dsh-profile-migrations.json'
const HOME_MARKERS_FILENAME = '.dsh-home-migrations.json'
const LEGACY_SETTINGS_FILENAME = 'settings.yaml'
const SESSION_LOG_ENTRY_ID = 'session-log-deepseek'
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

/** Set or remove literal enabled:true in one top-level Cordis patch sequence. */
async function migratePatch(path: string, remove: boolean): Promise<string | undefined> {
  const document = await readYamlDocument(path)
  if (document === undefined) return undefined
  if (!isSeq(document.contents)) throw new Error(`dsh: cannot migrate Session-log upload settings because ${path} is not a YAML sequence`)
  let changed = false
  for (const [index, row] of document.contents.items.entries()) {
    if (!isMap(row) || document.getIn([index, 'id']) !== SESSION_LOG_ENTRY_ID) continue
    const config = row.get('config')
    if (!isMap(config) || config.get('enabled') !== true) continue
    if (remove) {
      config.delete('enabled')
      if (config.items.length === 0) row.delete('config')
    } else document.setIn([index, 'config', 'enabled'], false)
    changed = true
  }
  return changed ? String(document) : undefined
}

/** Set literal enabled:true to false in the legacy Session-log settings section. */
async function migrateLegacySettings(path: string): Promise<string | undefined> {
  const document = await readYamlDocument(path)
  if (document === undefined || !isMap(document.contents)) return undefined
  const section = document.contents.get(SESSION_LOG_ENTRY_ID)
  if (!isMap(section) || section.get('enabled') !== true) return undefined
  document.setIn([SESSION_LOG_ENTRY_ID, 'enabled'], false)
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
