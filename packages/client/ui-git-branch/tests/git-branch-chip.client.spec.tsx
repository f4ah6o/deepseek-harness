// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type {} from '../src/client/index.ts'
import type { RemoteResult, WorkspaceGitStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { GitBranchChip } from '../src/client/GitBranchChip.tsx'
import { en } from '../src/client/locales.ts'

const t = (key: string, params?: Record<string, unknown>): string => {
  const template = en[key as keyof typeof en] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

const success = (value: WorkspaceGitStatus): RemoteResult<WorkspaceGitStatus> => ({ ok: true, value })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('GitBranchChip', () => {
  it('shows the sanitized branch label and refreshes on the configured interval', async () => {
    vi.useFakeTimers()
    const getStatus = vi.fn(async () =>
      success({
        state: { kind: 'branch', repository: 'shiguredo/zakuro-rs', branch: 'develop' },
        refreshMs: 5_000,
      }),
    )
    render(<GitBranchChip getStatus={getStatus} sessionId={SessionId('s1')} t={t as never} />)

    await act(async () => {
      await Promise.resolve()
    })
    const chip = screen.getByLabelText('Git branch: shiguredo/zakuro-rs:develop')
    expect(chip.textContent).toContain('shiguredo/zakuro-rs:develop')
    expect(chip.getAttribute('data-composer-stat')).toBe('git-branch')
    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it('aborts the in-flight Host call when the composer unmounts', () => {
    let signal: AbortSignal | undefined
    const getStatus = vi.fn((_sessionId: SessionId, requestSignal: AbortSignal): Promise<RemoteResult<WorkspaceGitStatus>> => {
      signal = requestSignal
      return new Promise<RemoteResult<WorkspaceGitStatus>>(() => {})
    })
    const { unmount } = render(<GitBranchChip getStatus={getStatus} sessionId={SessionId('s1')} t={t as never} />)
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('clears the previous Session label and cancels its request on Session change', async () => {
    let firstSignal: AbortSignal | undefined
    const getStatus = vi.fn((sessionId: SessionId, signal: AbortSignal): Promise<RemoteResult<WorkspaceGitStatus>> => {
      if (sessionId === SessionId('s1')) {
        firstSignal = signal
        return Promise.resolve(
          success({
            state: { kind: 'branch', repository: 'first', branch: 'main' },
            refreshMs: 5_000,
          }),
        )
      }
      return new Promise<RemoteResult<WorkspaceGitStatus>>(() => {})
    })
    const view = render(<GitBranchChip getStatus={getStatus} sessionId={SessionId('s1')} t={t as never} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByLabelText('Git branch: first:main')).toBeTruthy()

    view.rerender(<GitBranchChip getStatus={getStatus} sessionId={SessionId('s2')} t={t} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(firstSignal?.aborted).toBe(true)
    expect(screen.queryByLabelText('Git branch: first:main')).toBeNull()
  })

  it('keeps only the latest focus refresh and suppresses detached values without a checkout', async () => {
    const pending: Array<{ resolve: (status: RemoteResult<WorkspaceGitStatus>) => void; signal: AbortSignal }> = []
    const getStatus = vi.fn(
      (_sessionId: SessionId, signal: AbortSignal) =>
        new Promise<RemoteResult<WorkspaceGitStatus>>((resolve) => {
          pending.push({ resolve, signal })
        }),
    )
    render(<GitBranchChip getStatus={getStatus} sessionId={SessionId('s1')} t={t as never} />)
    expect(pending).toHaveLength(1)
    fireEvent.focus(window)
    expect(pending).toHaveLength(2)
    expect(pending[0]?.signal.aborted).toBe(true)
    await act(async () => {
      pending[1]?.resolve(success({ state: { kind: 'detached', repository: 'sample', revision: 'abc1234' }, refreshMs: 10_000 }))
      await Promise.resolve()
    })
    expect(screen.getByLabelText('Detached Git HEAD: sample@abc1234')).toBeTruthy()
    await act(async () => {
      pending[0]?.resolve(success({ state: { kind: 'none' }, refreshMs: 5_000 }))
      await Promise.resolve()
    })
    expect(screen.getByLabelText('Detached Git HEAD: sample@abc1234')).toBeTruthy()
  })

  it('pauses while the document is hidden and refreshes when visibility returns', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    const getStatus = vi.fn(async () => success({ state: { kind: 'branch', repository: 'sample', branch: 'main' }, refreshMs: 5_000 }))
    const view = render(<GitBranchChip getStatus={getStatus} sessionId={SessionId('s1')} t={t as never} />)
    try {
      expect(getStatus).not.toHaveBeenCalled()

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      fireEvent(document, new Event('visibilitychange'))
      await act(async () => {
        await Promise.resolve()
      })
      expect(getStatus).toHaveBeenCalledOnce()
      expect(screen.getByLabelText('Git branch: sample:main')).toBeTruthy()
    } finally {
      view.unmount()
      if (descriptor === undefined) Reflect.deleteProperty(document, 'visibilityState')
      else Object.defineProperty(document, 'visibilityState', descriptor)
    }
  })

  it('keeps the last branch label across Remote failures and retries on focus', async () => {
    const getStatus = vi
      .fn<() => Promise<RemoteResult<WorkspaceGitStatus>>>()
      .mockResolvedValueOnce(success({ state: { kind: 'branch', repository: 'sample', branch: 'main' }, refreshMs: 5_000 }))
      .mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'unavailable', {}) })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(success({ state: { kind: 'branch', repository: 'sample', branch: 'updated' }, refreshMs: 5_000 }))
    render(<GitBranchChip getStatus={getStatus} sessionId={SessionId('s1')} t={t as never} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByLabelText('Git branch: sample:main')).toBeTruthy()

    fireEvent.focus(window)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByLabelText('Git branch: sample:main')).toBeTruthy()

    fireEvent.focus(window)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByLabelText('Git branch: sample:main')).toBeTruthy()

    fireEvent(document, new Event('visibilitychange'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByLabelText('Git branch: sample:updated')).toBeTruthy()
    expect(getStatus).toHaveBeenCalledTimes(4)
  })
})
