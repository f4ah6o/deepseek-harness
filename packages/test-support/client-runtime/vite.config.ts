import tsdownConfig from './tsdown.config.ts'

import { defineConfig } from 'vite-plus'
import { resolveVitePackConfig } from '../../../scripts/resolve-vite-pack-config.ts'

export default defineConfig({
  test: {
    clearMocks: false,
  },
  pack: await resolveVitePackConfig(tsdownConfig),
})
