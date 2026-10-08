/** Client type face for the Host-owned `workspaceGit` Remote namespace. */
export type * from '../types.ts'

/**
 * Keep this Host-only namespace as a valid Client graph entry.
 * @returns Nothing; the separate composer package renders this Remote's values.
 */
export function apply(): void {}
