import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrateSessionLogUploadDefaults } from '../../src/session-log-upload-migration.ts'

const [home, profileDir, ready, gate] = process.argv.slice(2)
if (home === undefined || profileDir === undefined || ready === undefined || gate === undefined) {
  throw new Error('expected home, profile directory, ready marker, and gate path')
}
writeFileSync(ready, 'ready\n')
while (!existsSync(gate)) await new Promise(resolve => setTimeout(resolve, 10))
await migrateSessionLogUploadDefaults(profileDir, join(profileDir, 'cordis.patch.yml'), home, join(home, 'cordis.patch.yml'))
