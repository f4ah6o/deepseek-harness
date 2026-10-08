import { build } from 'vite-plus/pack'
import { rootPackConfig } from './root-pack-config.ts'

const args = process.argv.slice(2)
const [face] = args

if ((face === 'host' || face === 'client') && args.length === 1) {
  process.env.DSH_BUILD_FACE = face
  const config = rootPackConfig({ env: { DSH_BUILD_FACE: face } })
  await build({ ...config, configLoader: 'native', env: { DSH_BUILD_FACE: face } })
} else {
  throw new Error('usage: tsx scripts/run-vp-pack.ts host|client')
}
