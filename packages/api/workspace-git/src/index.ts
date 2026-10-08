/** Bounded Git metadata lookup for a Session's selected execution directory. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceGitState, WorkspaceGitStatus } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspaceGit` Remote namespace. */
    workspaceGit: WorkspaceGit
  }
}

/** Deployment limits for Git metadata requests and Client refreshes. */
export interface Config {
  /** Maximum time for resolving the Session directory and running Git metadata commands. */
  readonly deadlineMs: number
  /** Delay between successful Client metadata refreshes. */
  readonly refreshMs: number
}

/** Host Remote service that returns sanitized Git repository and branch metadata. */
export class WorkspaceGit extends TypertRemoteService {
  static inject = ['sandboxPolicy', 'sessions', 'subprocess', 'typert']

  static Config: z<Config> = z.object({
    deadlineMs: z.natural().min(1).max(30_000).default(2_000),
    refreshMs: z.natural().min(100).max(300_000).default(5_000),
  })

  private readonly config: Config
  private readonly lifetime = new AbortController()
  private readonly active = new Set<Promise<WorkspaceGitStatus>>()

  /**
   * @param ctx - Host context carrying Session, subprocess, and sandbox services.
   * @param config - request deadline and Client refresh interval.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'workspaceGit')
    this.config = WorkspaceGit.Config(config)
    ctx.effect(
      () => async () => {
        this.lifetime.abort(new Error('workspace Git service disposed'))
        await Promise.allSettled(this.active)
      },
      'workspaceGit: active requests',
    )
  }

  /**
   * Read current Git state from the selected Session's workspace in the
   * subprocess provider's execution world. Only an owner/repository pair from
   * `origin` is returned; credentials and remote URLs never cross the Remote.
   * @param sessionId - selected Session whose header supplies the working directory.
   * @param signal - cancels persistence reads and every spawned Git process.
   * @returns the sanitized branch, detached revision, or no-checkout state plus refresh interval.
   */
  @Remote
  status(sessionId: SessionId, signal: AbortSignal): Promise<WorkspaceGitStatus> {
    const request = this.readStatus(sessionId, signal)
    this.active.add(request)
    return request.finally(() => {
      this.active.delete(request)
    })
  }

  private async readStatus(sessionId: SessionId, signal: AbortSignal): Promise<WorkspaceGitStatus> {
    const deadline = new AbortController()
    const timer = setTimeout(() => {
      deadline.abort(new Error('workspace Git metadata deadline exceeded'))
    }, this.config.deadlineMs)
    const deadlineExpired = (): boolean => deadline.signal.aborted
    const requestSignal = AbortSignal.any([signal, deadline.signal, this.lifetime.signal])
    try {
      const cwd = await this.sessionDirectory(sessionId, requestSignal)
      if (cwd === undefined || deadlineExpired()) return this.snapshot({ kind: 'none' })
      const root = await this.git(cwd, ['rev-parse', '--show-toplevel'], requestSignal)
      if (root === undefined || deadlineExpired()) return this.snapshot({ kind: 'none' })
      const branch = await this.git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], requestSignal)
      if (deadlineExpired()) return this.snapshot({ kind: 'none' })
      const remote = await this.git(cwd, ['remote', 'get-url', 'origin'], requestSignal)
      if (deadlineExpired()) return this.snapshot({ kind: 'none' })
      const repository = repositoryOf(remote, root)
      if (branch !== undefined && branch !== '') return this.snapshot({ kind: 'branch', repository, branch })
      const revision = await this.git(cwd, ['rev-parse', '--short', 'HEAD'], requestSignal)
      if (revision === undefined || revision === '' || deadlineExpired()) return this.snapshot({ kind: 'none' })
      return this.snapshot({ kind: 'detached', repository, revision })
    } catch (error: unknown) {
      signal.throwIfAborted()
      if (deadlineExpired()) return this.snapshot({ kind: 'none' })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async sessionDirectory(sessionId: SessionId, signal: AbortSignal): Promise<string | undefined> {
    signal.throwIfAborted()
    const live = this.ctx.sessions.get(sessionId)?.header
    const stored = live === undefined ? await this.ctx.get('sessionPersistence')?.stat(sessionId, { signal }) : undefined
    signal.throwIfAborted()
    const header = live ?? stored?.header
    if (header === undefined) return undefined
    return header.cwd ?? this.ctx.sandboxPolicy.workspaceRoot
  }

  private async git(cwd: string, args: readonly string[], signal: AbortSignal): Promise<string | undefined> {
    signal.throwIfAborted()
    try {
      const indexedConfigEnv = Object.fromEntries(
        Object.keys(process.env)
          .filter((name) => /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/iu.test(name))
          .map((name) => [name, undefined]),
      )
      const child = this.ctx.subprocess.spawn({
        argv: ['git', '-C', cwd, ...args],
        cwd,
        // `git -C` does not override these environment-selected repositories.
        // Reset indexed config because the shared credential scrub removes
        // GIT_CONFIG_KEY_n before the counter can be read by Git; remove its
        // indexed values too because their names do not match that scrub.
        env: {
          ...indexedConfigEnv,
          GIT_CONFIG_COUNT: '0',
          GIT_CONFIG_PARAMETERS: undefined,
          GIT_CONFIG: undefined,
          GIT_DIR: undefined,
          GIT_WORK_TREE: undefined,
          GIT_COMMON_DIR: undefined,
          GIT_IMPLICIT_WORK_TREE: undefined,
          GIT_INDEX_FILE: undefined,
          GIT_OBJECT_DIRECTORY: undefined,
          GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
          GIT_CEILING_DIRECTORIES: undefined,
          GIT_DISCOVERY_ACROSS_FILESYSTEM: undefined,
          GIT_GRAFT_FILE: undefined,
          GIT_NAMESPACE: undefined,
          GIT_NO_REPLACE_OBJECTS: undefined,
          GIT_REPLACE_REF_BASE: undefined,
          GIT_PREFIX: undefined,
          GIT_SHALLOW_FILE: undefined,
        },
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 4_096 },
          stderr: { maxBytes: 1_024 },
        },
        graceMs: this.config.deadlineMs,
        signal,
      })
      const outcome = await child.done
      signal.throwIfAborted()
      if (outcome.exitCode !== 0) return undefined
      return child.collected.stdout?.readFrom(0).text.trim()
    } catch (_error: unknown) {
      signal.throwIfAborted()
      // A missing Git executable or a directory outside a checkout is an empty
      // status, not an application failure. Other callers still see aborts.
      return undefined
    }
  }

  private snapshot(state: WorkspaceGitState): WorkspaceGitStatus {
    return { state, refreshMs: this.config.refreshMs }
  }
}

/** Convert an origin URL to an owner/repository display, otherwise name the Git root. */
function repositoryOf(remote: string | undefined, root: string): string {
  const path = githubPath(remote)
  return path ?? pathBasename(root)
}

/** Extract only a GitHub owner/repository path from HTTP, SSH URL, or scp syntax. */
function githubPath(remote: string | undefined): string | undefined {
  if (remote === undefined) return undefined
  let host: string | undefined
  let path: string | undefined
  try {
    const url = new URL(remote)
    host = url.hostname.toLowerCase()
    path = url.pathname
  } catch {
    const match = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(remote)
    host = match?.[1]?.toLowerCase()
    path = match?.[2]
  }
  if (host !== 'github.com' || path === undefined) return undefined
  const normalizedPath = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(normalizedPath)
  if (match === null) return undefined
  return `${match[1]}/${match[2]}`
}

/** Return the final path component, or the root itself, with either execution-world separator. */
function pathBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/g, '')
  if (trimmed === '') return path
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}

export default WorkspaceGit
