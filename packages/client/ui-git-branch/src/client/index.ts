/** Client composer contribution showing the selected Session's Git branch. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { GitBranchKey } from './locales.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { GitBranchChip } from './GitBranchChip.tsx'
import { en, NS, zh } from './locales.ts'

export { GitBranchChip } from './GitBranchChip.tsx'
export type { GitBranchChipInjected } from './GitBranchChip.tsx'
export { en, NS, zh }
export type { GitBranchKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only branch and detached HEAD status in the composer dock. */
    gitBranch: GitBranchKey
  }
}

/** Required services: slot registry, dictionaries, and mounted workspace Git Remote. */
export const inject = ['slots', 'locale', 'remote', 'remote.workspaceGit']

/**
 * Register the Git status chip before the turn and token statistics in the composer dock.
 * @param ctx - Client Context carrying slots, locale, and the Remote face.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-git-branch: dictionaries')
  const getStatus = (sessionId: SessionId, signal: AbortSignal) => ctx.remote.workspaceGit.status(sessionId, signal)
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'git-branch',
        order: -1,
        locale: NS,
        inject: (sessionId) => ({ sessionId, getStatus }),
      },
      GitBranchChip,
    ),
  )
}
