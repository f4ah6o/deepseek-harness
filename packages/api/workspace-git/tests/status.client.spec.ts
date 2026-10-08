/** workspaceGit Client face: the Host-owned namespace remains passive. */
import { describe, expect, it } from 'vite-plus/test'
import { apply } from '../src/client/index.ts'

describe('workspaceGit Client face', () => {
  it('exports a passive Client entry for the Host-owned Remote namespace', () => {
    expect(() => {
      apply()
    }).not.toThrow()
  })
})
