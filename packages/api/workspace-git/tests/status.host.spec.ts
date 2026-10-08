import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { apply as applyClientEntry } from '../src/client/index.ts'
import WorkspaceGit from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function repository(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-workspace-git-${name}-`))
  roots.push(root)
  const cwd = join(root, name)
  await mkdir(cwd)
  git(cwd, 'init', '-b', 'develop')
  git(cwd, 'config', 'user.name', 'Test User')
  git(cwd, 'config', 'user.email', 'test@example.invalid')
  await writeFile(join(cwd, 'README.md'), 'workspace Git status test\n')
  git(cwd, 'add', 'README.md')
  git(cwd, 'commit', '-m', 'initial')
  return cwd
}

/** Handle that settles only after the provider-owned abort signal fires. */
function waitingForAbort(spec: SubprocessSpawnSpec): SubprocessHandle {
  const signal = spec.signal
  if (signal === undefined) throw new Error('workspace Git must cancel its subprocess')
  const done = new Promise<SubprocessOutcome>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      },
      { once: true },
    )
  })
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {},
    done,
    terminate: () => {},
    waitForExit: async () => false,
  }
}

/** Completed process result used to model a child that settles during deadline cancellation. */
function completedGit(spec: SubprocessSpawnSpec, text: string, exitCode = 0, delayMs = 0): SubprocessHandle {
  const signal = spec.signal
  if (delayMs > 0 && signal !== undefined) {
    // Let the simulated child settle after its deadline so the caller's
    // post-command checkpoint, rather than the abort throw, owns the result.
    signal.throwIfAborted = () => {}
  }
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stdout: {
        readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }),
      },
    },
    done: new Promise((resolve) => {
      setTimeout(() => {
        resolve({ exitCode, signal: null })
      }, delayMs)
    }),
    terminate: () => {},
    waitForExit: async () => true,
  }
}

describe('workspaceGit.status', () => {
  it('keeps the Host-owned Remote namespace passive in the Client type face', () => {
    expect(() => {
      applyClientEntry()
    }).not.toThrow()
  })

  it('uses the selected Session cwd and returns only a sanitized GitHub owner/repository', async () => {
    const cwd = await repository('source')
    git(cwd, 'remote', 'add', 'origin', 'https://alice:top-secret@github.com/shiguredo/zakuro-rs.git')
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: tmpdir() } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    // Keep this behavior test independent of the service's two-second
    // production deadline; it launches several real Git subprocesses in the
    // shared parallel test lane. The deadline itself has a controlled test below.
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 10_000, refreshMs: 5_000 })
    const id = SessionId('branch-session')
    ctx.sessions.create(id, { meta: { cwd } })

    try {
      await expect(ctx.workspaceGit.status(id, new AbortController().signal)).resolves.toEqual({
        state: { kind: 'branch', repository: 'shiguredo/zakuro-rs', branch: 'develop' },
        refreshMs: 5_000,
      })
      const body = JSON.stringify(await ctx.workspaceGit.status(id, new AbortController().signal))
      expect(body).not.toContain('top-secret')
      expect(body).not.toContain('github.com')
      expect(body).not.toContain(cwd)
    } finally {
      await service.dispose()
      await subprocess.dispose()
      await sessions.dispose()
      await typert.dispose()
    }
  })

  it('finds repository metadata when the Session cwd is nested below the Git root', async () => {
    const root = await repository('nested-root')
    git(root, 'remote', 'add', 'origin', 'git@github.com:shiguredo/nested-repo.git')
    const cwd = join(root, 'packages', 'app')
    await mkdir(cwd, { recursive: true })
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: tmpdir() } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 10_000, refreshMs: 5_000 })
    const id = SessionId('nested-session')
    ctx.sessions.create(id, { meta: { cwd } })

    try {
      await expect(ctx.workspaceGit.status(id, new AbortController().signal)).resolves.toEqual({
        state: { kind: 'branch', repository: 'shiguredo/nested-repo', branch: 'develop' },
        refreshMs: 5_000,
      })
    } finally {
      await service.dispose()
      await subprocess.dispose()
      await sessions.dispose()
      await typert.dispose()
    }
  })

  it('reads branch metadata from a linked Git worktree', async () => {
    const source = await repository('worktree-source')
    git(source, 'remote', 'add', 'origin', 'https://github.com/shiguredo/worktree-repo.git')
    const worktree = join(source, '..', 'linked-worktree')
    git(source, 'worktree', 'add', '-b', 'linked-branch', worktree)
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: tmpdir() } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 10_000, refreshMs: 5_000 })
    const id = SessionId('worktree-session')
    ctx.sessions.create(id, { meta: { cwd: worktree } })

    try {
      await expect(ctx.workspaceGit.status(id, new AbortController().signal)).resolves.toEqual({
        state: { kind: 'branch', repository: 'shiguredo/worktree-repo', branch: 'linked-branch' },
        refreshMs: 5_000,
      })
    } finally {
      await service.dispose()
      await subprocess.dispose()
      await sessions.dispose()
      await typert.dispose()
    }
  })

  it('uses the configured workspace root when the Session has no cwd', async () => {
    const cwd = await repository('workspace-root-fallback')
    git(cwd, 'remote', 'add', 'origin', 'https://github.com/shiguredo/workspace-root.git')
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: cwd } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 10_000, refreshMs: 5_000 })
    const id = SessionId('workspace-root-session')
    ctx.sessions.create(id, { meta: {} })

    try {
      await expect(ctx.workspaceGit.status(id, new AbortController().signal)).resolves.toEqual({
        state: { kind: 'branch', repository: 'shiguredo/workspace-root', branch: 'develop' },
        refreshMs: 5_000,
      })
    } finally {
      await service.dispose()
      await subprocess.dispose()
      await sessions.dispose()
      await typert.dispose()
    }
  })

  it('falls back to the Git root when origin is absent or is not a valid GitHub owner/repository', async () => {
    const cwd = await repository('origin-fallback')
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: tmpdir() } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 10_000, refreshMs: 5_000 })
    const id = SessionId('origin-fallback-session')
    ctx.sessions.create(id, { meta: { cwd } })

    try {
      const absent = await ctx.workspaceGit.status(id, new AbortController().signal)
      expect(absent.state).toEqual({ kind: 'branch', repository: 'origin-fallback', branch: 'develop' })

      const invalidOrigins = [
        'https://github.com/owner_name/repo.git',
        'https://github.com/owner/repo%3A.git',
        'https://github.com/owner/repo/extra.git',
      ]
      for (const origin of invalidOrigins) {
        git(cwd, 'remote', 'add', 'origin', origin)
        const status = await ctx.workspaceGit.status(id, new AbortController().signal)
        expect(status.state).toEqual({ kind: 'branch', repository: 'origin-fallback', branch: 'develop' })
        git(cwd, 'remote', 'remove', 'origin')
      }
    } finally {
      await service.dispose()
      await subprocess.dispose()
      await sessions.dispose()
      await typert.dispose()
    }
  }, 15_000)

  it('ignores inherited indexed Git config and repository selectors', async () => {
    const selectedCwd = await repository('selected-repository')
    const ambientCwd = await repository('ambient-repository')
    git(selectedCwd, 'remote', 'add', 'origin', 'https://alice:session-secret@github.com/shiguredo/selected.git')
    git(ambientCwd, 'checkout', '-b', 'ambient-branch')
    git(ambientCwd, 'remote', 'add', 'origin', 'https://alice:ambient-secret@github.com/shiguredo/ambient.git')

    const names = [
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
      'GIT_CONFIG_PARAMETERS',
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_COMMON_DIR',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_CEILING_DIRECTORIES',
      'GIT_DISCOVERY_ACROSS_FILESYSTEM',
    ] as const
    const original = new Map(names.map((name) => [name, process.env[name]] as const))
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: tmpdir() } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 2_000, refreshMs: 5_000 })
    const id = SessionId('selected-session')
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')

    try {
      process.env.GIT_CONFIG_COUNT = '1'
      process.env.GIT_CONFIG_KEY_0 = 'core.bare'
      process.env.GIT_CONFIG_VALUE_0 = 'config-value-secret'
      process.env.GIT_CONFIG_PARAMETERS = "'core.bare'='true'"
      process.env.GIT_DIR = join(ambientCwd, '.git')
      process.env.GIT_WORK_TREE = ambientCwd
      process.env.GIT_COMMON_DIR = join(ambientCwd, '.git')
      process.env.GIT_INDEX_FILE = join(ambientCwd, '.git', 'index')
      process.env.GIT_OBJECT_DIRECTORY = join(ambientCwd, '.git', 'objects')
      process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = join(ambientCwd, '.git', 'objects')
      process.env.GIT_CEILING_DIRECTORIES = ambientCwd
      process.env.GIT_DISCOVERY_ACROSS_FILESYSTEM = '1'
      ctx.sessions.create(id, { meta: { cwd: selectedCwd } })
      const status = await ctx.workspaceGit.status(id, new AbortController().signal)
      expect(status).toEqual({
        state: { kind: 'branch', repository: 'shiguredo/selected', branch: 'develop' },
        refreshMs: 5_000,
      })
      const body = JSON.stringify(status)
      expect(body).not.toContain('session-secret')
      expect(body).not.toContain('ambient-secret')
      expect(body).not.toContain('config-value-secret')
      expect(spawn).toHaveBeenCalled()
      for (const [spec] of spawn.mock.calls) {
        expect(spec.env?.GIT_CONFIG_COUNT).toBe('0')
        expect(spec.env?.GIT_CONFIG_VALUE_0).toBeUndefined()
        expect(spec.env?.GIT_CONFIG_PARAMETERS).toBeUndefined()
        expect(spec.env?.GIT_DIR).toBeUndefined()
        expect(spec.env?.GIT_WORK_TREE).toBeUndefined()
        expect(spec.env?.GIT_COMMON_DIR).toBeUndefined()
      }
    } finally {
      try {
        spawn.mockRestore()
        await service.dispose()
        await subprocess.dispose()
        await sessions.dispose()
        await typert.dispose()
      } finally {
        for (const name of names) {
          const value = original.get(name)
          if (value === undefined) Reflect.deleteProperty(process.env, name)
          else process.env[name] = value
        }
      }
    }
  }, 10_000)

  it('reports a detached revision and falls back to the Git root name for non-GitHub origins', async () => {
    const cwd = await repository('fallback-root')
    git(cwd, 'remote', 'add', 'origin', 'https://alice:top-secret@gitlab.com/team/private.git')
    git(cwd, 'checkout', '--detach', 'HEAD')
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: tmpdir() } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 10_000, refreshMs: 7_500 })
    const id = SessionId('detached-session')
    ctx.sessions.create(id, { meta: { cwd } })

    try {
      const status = await ctx.workspaceGit.status(id, new AbortController().signal)
      expect(status).toMatchObject({
        state: { kind: 'detached', repository: 'fallback-root' },
        refreshMs: 7_500,
      })
      expect(status.state.kind === 'detached' ? status.state.revision : undefined).toMatch(/^[0-9a-f]{7,}$/)
      expect(JSON.stringify(status)).not.toContain('top-secret')
    } finally {
      await service.dispose()
      await subprocess.dispose()
      await sessions.dispose()
      await typert.dispose()
    }
  })

  it('returns none outside a checkout and does not start a subprocess for an aborted request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-git-none-'))
    roots.push(root)
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: root } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 2_000, refreshMs: 5_000 })
    const id = SessionId('plain-session')
    ctx.sessions.create(id, { meta: { cwd: root } })
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')

    try {
      await expect(ctx.workspaceGit.status(SessionId('missing-session'), new AbortController().signal)).resolves.toEqual({
        state: { kind: 'none' },
        refreshMs: 5_000,
      })
      await expect(ctx.workspaceGit.status(id, new AbortController().signal)).resolves.toEqual({
        state: { kind: 'none' },
        refreshMs: 5_000,
      })
      await expect(ctx.workspaceGit.status(id, AbortSignal.abort(new Error('session changed')))).rejects.toThrow('session changed')
      expect(spawn).toHaveBeenCalledOnce()
    } finally {
      await service.dispose()
      await subprocess.dispose()
      await sessions.dispose()
      await typert.dispose()
    }
  })

  it('terminates Git when the configured request deadline expires', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-git-deadline-'))
    roots.push(root)
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: root } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 10, refreshMs: 5_000 })
    const id = SessionId('deadline-session')
    ctx.sessions.create(id, { meta: { cwd: root } })
    const spawn = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => waitingForAbort(spec))

    try {
      await expect(ctx.workspaceGit.status(id, new AbortController().signal)).resolves.toMatchObject({
        state: { kind: 'none' },
        refreshMs: 5_000,
      })
      expect(spawn).toHaveBeenCalledOnce()
      expect(spawn.mock.calls[0]?.[0].signal?.aborted).toBe(true)
    } finally {
      await service.dispose()
      await subprocess.dispose()
      await sessions.dispose()
      await typert.dispose()
    }
  })

  it.each(['session directory', 'repository root', 'branch', 'origin', 'detached revision'] as const)(
    'returns no status when %s completes after the request deadline',
    async (stage) => {
      const cwd = tmpdir()
      const ctx = new Context()
      ctx.provide('sandboxPolicy', { workspaceRoot: cwd } as never)
      const sessions = await ctx.plugin(SessionStore)
      const subprocess = await ctx.plugin(LocalSubprocessRuntime)
      const typert = await ctx.plugin(TypertRegistry)
      const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 5, refreshMs: 5_000 })
      const id = SessionId(`deadline-${stage.replaceAll(' ', '-')}`)
      const spawn = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
        const args = spec.argv.slice(3)
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
          return completedGit(spec, cwd, 0, stage === 'repository root' ? 25 : 0)
        }
        if (args[0] === 'symbolic-ref') {
          return completedGit(
            spec,
            stage === 'detached revision' ? '' : 'develop',
            stage === 'detached revision' ? 1 : 0,
            stage === 'branch' ? 25 : 0,
          )
        }
        if (args[0] === 'remote') return completedGit(spec, 'https://github.com/owner/repo.git', 0, stage === 'origin' ? 25 : 0)
        if (args[0] === 'rev-parse' && args[1] === '--short')
          return completedGit(spec, 'abc1234', 0, stage === 'detached revision' ? 25 : 0)
        throw new Error(`Unexpected Git command: ${args.join(' ')}`)
      })
      if (stage === 'session directory') {
        ctx.provide('sessionPersistence', {
          stat: async (_sessionId: SessionId, options: { signal?: AbortSignal }) => {
            const signal = options.signal
            if (signal === undefined) throw new Error('workspace Git must cancel persistence reads')
            await new Promise((resolve) => setTimeout(resolve, 25))
            signal.throwIfAborted = () => {}
            return { header: { id, createdAt: 1, cwd }, revision: 'test' }
          },
        } as never)
      } else {
        ctx.sessions.create(id, { meta: { cwd } })
      }

      try {
        await expect(ctx.workspaceGit.status(id, new AbortController().signal)).resolves.toEqual({
          state: { kind: 'none' },
          refreshMs: 5_000,
        })
        if (stage === 'session directory') expect(spawn).not.toHaveBeenCalled()
        else expect(spawn).toHaveBeenCalled()
      } finally {
        await service.dispose()
        await subprocess.dispose()
        await sessions.dispose()
        await typert.dispose()
      }
    },
  )

  it('aborts and drains an in-flight Git command when the Host service is disposed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-git-dispose-'))
    roots.push(root)
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { workspaceRoot: root } as never)
    const sessions = await ctx.plugin(SessionStore)
    const subprocess = await ctx.plugin(LocalSubprocessRuntime)
    const typert = await ctx.plugin(TypertRegistry)
    const service = await ctx.plugin(WorkspaceGit, { deadlineMs: 5_000, refreshMs: 5_000 })
    const id = SessionId('dispose-session')
    ctx.sessions.create(id, { meta: { cwd: root } })
    const spawn = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => waitingForAbort(spec))
    const status = ctx.workspaceGit.status(id, new AbortController().signal)

    try {
      await vi.waitFor(() => {
        expect(spawn).toHaveBeenCalledOnce()
      })
      await service.dispose()
      await expect(status).rejects.toThrow('workspace Git service disposed')
      expect(spawn.mock.calls[0]?.[0].signal?.aborted).toBe(true)
    } finally {
      await subprocess.dispose()
      await sessions.dispose()
      await typert.dispose()
    }
  })
})
