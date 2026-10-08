import type { RemoteResult, WorkspaceGitStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './GitBranchChip.module.css'

/** The per-Session Host call supplied by the composer slot. */
export interface GitBranchChipInjected {
  /** Read sanitized status for a Session using the slot's current Remote face. */
  readonly getStatus: (sessionId: SessionId, signal: AbortSignal) => Promise<RemoteResult<WorkspaceGitStatus>>
  /** Owning Session identity for lifecycle diagnostics and stable remounting. */
  readonly sessionId: SessionId
}

/**
 * Read and refresh sanitized Git metadata for one mounted composer. Cleanup
 * aborts the Host RPC on Session change or unmount; generation checks keep a
 * response from an older focus refresh from replacing a newer one.
 * @param props - Session RPC and locale seat supplied by the slot registry.
 * @returns one read-only composer status chip, or nothing outside a checkout.
 */
export function GitBranchChip({ getStatus, sessionId, t }: GitBranchChipInjected & PropsLocale<'gitBranch'>) {
  const [snapshot, setSnapshot] = useState<WorkspaceGitStatus | null>(null)

  useEffect(() => {
    setSnapshot(null)
    let generation = 0
    let disposed = false
    let pending: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const refresh = (): void => {
      if (disposed || document.visibilityState !== 'visible') return
      if (timer !== undefined) clearTimeout(timer)
      const current = ++generation
      pending?.abort()
      const controller = new AbortController()
      pending = controller
      void getStatus(sessionId, controller.signal)
        .then((result) => {
          if (disposed || controller.signal.aborted || current !== generation) return
          if (!result.ok) return
          const next = result.value
          setSnapshot(next)
          timer = setTimeout(refresh, next.refreshMs)
        })
        .catch((_error: unknown) => {
          // Remote failures leave the last observed repository label in place.
          // Focus and visibility changes retry; a later successful call restores polling.
        })
    }
    const onVisibility = (): void => {
      refresh()
    }
    const onFocus = (): void => {
      refresh()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    refresh()
    return () => {
      disposed = true
      generation++
      pending?.abort()
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [getStatus, sessionId])

  const state = snapshot?.state
  if (state === undefined || state.kind === 'none') return null
  const ref = state.kind === 'branch' ? `${state.repository}:${state.branch}` : `${state.repository}@${state.revision}`
  const aria = state.kind === 'branch' ? t('branch.aria', { ref }) : t('detached.aria', { ref })

  return (
    <span className={css.anchor} data-composer-stat="git-branch" aria-label={aria} title={aria}>
      <IconBranchOutlineRegular />
      <span className={css.label}>{ref}</span>
    </span>
  )
}
