import tsdownConfig from './tsdown.config.ts'

import { defineConfig } from 'vite-plus'
import { resolveVitePackConfig } from '../scripts/resolve-vite-pack-config.ts'

export default defineConfig({
  pack: await resolveVitePackConfig(tsdownConfig),
})
