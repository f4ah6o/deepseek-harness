/** Client-safe values returned by the `workspaceGit` Remote namespace. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Git state for the selected Session's execution directory. */
export type WorkspaceGitState =
  | { readonly kind: 'branch'; readonly repository: string; readonly branch: string }
  | { readonly kind: 'detached'; readonly repository: string; readonly revision: string }
  | { readonly kind: 'none' }

/** Git state and the configured delay before the Client refreshes it. */
export interface WorkspaceGitStatus {
  /** Current branch, detached revision, or absence of a Git checkout. */
  readonly state: WorkspaceGitState
  /** Configured delay between successful Client refreshes in milliseconds. */
  readonly refreshMs: number
}
