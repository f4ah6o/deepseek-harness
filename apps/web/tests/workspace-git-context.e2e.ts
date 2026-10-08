/** Session-owned project, provider, and Git metadata through the shipped Web composition. */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, readPersistedEvents, seedSession,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./workspace-git-context.overlay.yml', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/workspace-git-context/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const PROJECT_SESSION = 'workspace-git-context-project'
const OTHER_SESSION = 'workspace-git-context-other'
const PROJECT_TITLE = 'Project Atlas'

/** Return a subprocess handle whose owner can observe and release cancellation. */
function waitForAbort(
  spec: SubprocessSpawnSpec,
  aborted: () => void,
): SubprocessHandle {
  const signal = spec.signal
  if (signal === undefined) throw new Error('generated workspaceGit call must pass a cancellation signal')
  const done = new Promise<SubprocessOutcome>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      aborted()
      reject(new Error('workspace Git subprocess was cancelled'))
    }, { once: true })
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

/** Create a committed local checkout with a credential-bearing GitHub origin. */
async function initializeRepository(cwd: string): Promise<void> {
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd, stdio: 'ignore' }) }
  git('init', '-b', 'develop')
  git('config', 'user.name', 'Web Context Fixture')
  git('config', 'user.email', 'web-context@example.invalid')
  git('remote', 'add', 'origin', 'https://fixture-secret@github.com/shiguredo/zakuro-rs.git')
  await writeFile(join(cwd, 'README.md'), 'fixture\n')
  git('add', 'README.md')
  git('commit', '-m', 'fixture')
}

describe('web e2e: Session project, model provider, and Git context', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let projectCwd = ''
  let otherCwd = ''

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    await scaffold.ctx.settings.update('locale', { preference: 'en' })
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        'fork-gateway': {
          displayName: 'Fork Provider',
          api: 'openai-completions',
          baseURL: 'https://gateway.fixture.invalid/v1',
          models: [{ id: 'fork-model', name: 'Fork Model' }],
        },
      },
    })

    projectCwd = join(scaffold.workspaceCwd, 'named-project')
    otherCwd = join(scaffold.workspaceCwd, 'other-project')
    await mkdir(projectCwd, { recursive: true })
    await mkdir(otherCwd, { recursive: true })
    await initializeRepository(projectCwd)
    const fixture = await readFile(SEED, 'utf8')
    const projectSessionId = await seedSession(scaffold, fixture, PROJECT_SESSION, undefined, {
      createdAt: 10,
      cwd: projectCwd,
    })
    await seedSession(scaffold, fixture, OTHER_SESSION, undefined, {
      createdAt: 20,
      cwd: otherCwd,
    })
    const workspace = await scaffold.ctx.workspaceRegistry.create(projectCwd, PROJECT_TITLE)
    await workspace.attachSession(projectSessionId)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    try {
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    } catch (error) {
      console.error('workspace Git context Web startup failed', {
        url: page.url(),
        body: (await page.locator('body').innerText()).slice(0, 1_000),
        pageErrors: tripwire.pageErrors,
      })
      throw error
    }
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders the project, provider, and sanitized branch, then cancels a generated Remote on Session switch', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workspace-git-context'))
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'In one list' }).click()

    const projectRow = page.locator(`[data-row-key="session:${PROJECT_SESSION}"]`)
    const otherRow = page.locator(`[data-row-key="session:${OTHER_SESSION}"]`)
    await projectRow.waitFor({ timeout: 15_000 })
    await otherRow.waitFor({ timeout: 15_000 })
    await expect.poll(() => projectRow.getByText(PROJECT_TITLE, { exact: true }).isVisible()).toBe(true)
    const rowText = await projectRow.innerText()
    expect(rowText.indexOf(PROJECT_TITLE)).toBeLessThan(rowText.indexOf('Untitled'))

    await projectRow.click()
    const branchChip = page.locator('[data-composer-stat="git-branch"]')
    await expect.poll(() => branchChip.getAttribute('aria-label'), { timeout: 15_000 })
      .toBe('Git branch: shiguredo/zakuro-rs:develop')
    const modelTrigger = page.getByRole('button', { name: /^Select model/ })
    await expect.poll(() => modelTrigger.isVisible()).toBe(true)
    await modelTrigger.click()
    await page.getByRole('menuitem', { name: /^Model/ }).click()
    const forkModel = page.getByRole('menuitemradio', { name: 'Fork Model', exact: true })
    await expect.poll(() => forkModel.count()).toBe(1)
    await forkModel.click()
    const selectedModelTrigger = page.getByRole('button', { name: /Fork Provider.*Fork Model/ })
    await expect.poll(() => selectedModelTrigger.count()).toBe(1)
    await selectedModelTrigger.click()
    await page.getByRole('menuitem', { name: /^Model/ }).click()
    const modelMenu = page.getByRole('group', { name: 'Model and reasoning effort', exact: true })
    await expect.poll(() => modelMenu.locator('[class*="providerValue"]').innerText()).toBe('Fork Provider')

    await expect.poll(async () => (await readPersistedEvents(scaffold, SessionId(PROJECT_SESSION)))
      .some(event => event.type === 'model/selection'
        && event.data.provider === 'fork-gateway' && event.data.model === 'fork-model')).toBe(true)
    const beforeEvents = await readPersistedEvents(scaffold, SessionId(PROJECT_SESSION))
    const expected = [
      '## Session list',
      await captureStableAria(page, '[role="tree"][aria-label="Sessions"]', scaffold.workspaceCwd, { normalizeAge: true }),
      '## Composer',
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd, { normalizeAge: true }),
      '## Model selector',
      await modelMenu.ariaSnapshot(),
    ].join('\n\n')
    await compareOrRefreshGolden(EXPECTED, expected, MODE)
    await expect.poll(async () => JSON.stringify(await readPersistedEvents(scaffold, SessionId(PROJECT_SESSION))))
      .toBe(JSON.stringify(beforeEvents))

    await page.keyboard.press('Escape')
    const started = Promise.withResolvers<AbortSignal>()
    const cancellation = Promise.withResolvers<undefined>()
    const subprocess = scaffold.ctx.subprocess
    const originalSpawn = subprocess.spawn.bind(subprocess)
    const spawn = vi.spyOn(subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv[0] === 'git' && spec.argv[1] === '-C' && spec.argv[2] === projectCwd) {
        started.resolve(spec.signal ?? AbortSignal.abort(new Error('Host call omitted its signal')))
        return waitForAbort(spec, () => { cancellation.resolve(undefined) })
      }
      return originalSpawn(spec)
    })
    try {
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')) })
      const signal = await started.promise
      expect(signal.aborted).toBe(false)
      await otherRow.click()
      await cancellation.promise
      expect(signal.aborted).toBe(true)
      await expect.poll(() => branchChip.count()).toBe(0)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } finally {
      spawn.mockRestore()
    }
  }, 90_000)
})
