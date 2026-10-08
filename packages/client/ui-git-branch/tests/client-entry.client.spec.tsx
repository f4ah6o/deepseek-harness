// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { act } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceGitStatus } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply as applyHostEntry } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'

const runtimes: SlotTestRuntime[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
})

describe('Git branch entrypoints', () => {
  it('keeps the package Host entry loadable without starting Host services', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(applyHostEntry)
    await fiber.await()
    expect(ctx.get('workspaceGit')).toBeUndefined()
    await fiber.dispose()
  })

  it('registers the localized composer chip against the public workspace Git Remote and disposes it', async () => {
    const runtime = await SlotTestRuntime.create()
    runtimes.push(runtime)
    let requestSignal: AbortSignal | undefined
    const status = vi.fn(async (_sessionId: SessionId, signal: AbortSignal) => {
      requestSignal = signal
      return {
        ok: true as const,
        value: {
          state: { kind: 'branch' as const, repository: 'shiguredo/zakuro-rs', branch: 'develop' },
          refreshMs: 5_000,
        } satisfies WorkspaceGitStatus,
      }
    })
    runtime.remote.provideNamespaces({ workspaceGit: { status } })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.declare({ 'conversation.composer.dock': { kind: 'list', scope: 'session' } })
    await runtime.mount({ inject: [...inject], apply })
    const id = await runtime.sessions.add({ id: 'git-session' })
    const reference = runtime.sessions.retain(id)
    await reference.ready

    try {
      const view = runtime.renderSlot('conversation.composer.dock', {}, { session: reference })
      await act(async () => {
        await Promise.resolve()
      })
      expect(view.view.getByLabelText('Git branch: shiguredo/zakuro-rs:develop')).toBeTruthy()
      expect(status).toHaveBeenCalledOnce()
      expect(status.mock.calls[0]?.[0]).toBe(id)

      await runtime.dispose()
      expect(requestSignal?.aborted).toBe(true)
      expect(runtime.slots.entries('conversation.composer.dock')).toHaveLength(0)
    } finally {
      await runtime.dispose()
    }
  })
})
