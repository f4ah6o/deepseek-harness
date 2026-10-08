/** Session-owned project, provider, and Git metadata through the shipped Web composition. */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vite-plus/test'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  readPersistedEvents,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./workspace-git-context.overlay.yml', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/workspace-git-context/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const PROJECT_SESSION = 'workspace-git-context-project'
const OTHER_SESSION = 'workspace-git-context-other'
const PROJECT_TITLE = '長い日本語プロジェクト名を狭い画面で確認するテスト用ワークスペース'
const PROVIDER_TITLE = '長い日本語プロバイダー名を狭い画面で確認するテスト用表示名'
const MODEL_TITLE = '長い日本語モデル名を狭い画面で確認するテスト用モデル'
const BRANCH_NAME = 'feature/長い日本語ブランチ名の表示を狭い画面で確認する'
const REPOSITORY_NAME = 'long-project-name-for-narrow-viewport-git-context-display'

/** Return a subprocess handle whose owner can observe and release cancellation. */
function waitForAbort(spec: SubprocessSpawnSpec, aborted: () => void): SubprocessHandle {
  const signal = spec.signal
  if (signal === undefined) throw new Error('generated workspaceGit call must pass a cancellation signal')
  const done = new Promise<SubprocessOutcome>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        aborted()
        reject(new Error('workspace Git subprocess was cancelled'))
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

/** Create a committed local checkout with a credential-bearing GitHub origin. */
async function initializeRepository(cwd: string): Promise<void> {
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd, stdio: 'ignore' })
  }
  git('init', '-b', BRANCH_NAME)
  git('config', 'user.name', 'Web Context Fixture')
  git('config', 'user.email', 'web-context@example.invalid')
  git('remote', 'add', 'origin', `https://fixture-secret@github.com/shiguredo/${REPOSITORY_NAME}.git`)
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
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, locale: null })
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        'fork-gateway': {
          displayName: PROVIDER_TITLE,
          api: 'openai-completions',
          baseURL: 'https://gateway.fixture.invalid/v1',
          models: [{ id: 'fork-model', name: MODEL_TITLE }],
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
    page = await browser.newPage({
      viewport: { width: 1680, height: 1000 },
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    })
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
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('ja')
    await page.getByRole('button', { name: '表示オプション' }).click()
    await page.getByRole('menuitem', { name: '単一リスト' }).click()

    const projectRow = page.locator(`[data-row-key="session:${PROJECT_SESSION}"]`)
    const otherRow = page.locator(`[data-row-key="session:${OTHER_SESSION}"]`)
    await projectRow.waitFor({ timeout: 15_000 })
    await otherRow.waitFor({ timeout: 15_000 })
    await expect.poll(() => projectRow.getByText(PROJECT_TITLE, { exact: true }).isVisible()).toBe(true)
    const rowText = await projectRow.innerText()
    expect(rowText.indexOf(PROJECT_TITLE)).toBeLessThan(rowText.indexOf('無題'))

    await projectRow.click()
    const branchChip = page.locator('[data-composer-stat="git-branch"]')
    await expect
      .poll(() => branchChip.getAttribute('aria-label'), { timeout: 15_000 })
      .toBe(`ブランチ shiguredo/${REPOSITORY_NAME}:${BRANCH_NAME}`)
    const modelTrigger = page.locator('[data-composer-card] button[aria-haspopup="menu"]')
    await expect.poll(() => modelTrigger.isVisible()).toBe(true)
    await modelTrigger.press('Enter')
    const modelRow = page.getByRole('menuitem', { name: /^モデル/ })
    await expect.poll(() => modelRow.count()).toBe(1)
    await modelTrigger.press('Tab')
    await expect.poll(() => modelRow.evaluate((element) => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    const forkModel = page.getByRole('menuitemradio', { name: MODEL_TITLE, exact: true })
    await expect.poll(() => forkModel.count()).toBe(1)
    const modelCount = await page.getByRole('menuitemradio').count()
    for (let step = 0; step < modelCount; step++) {
      if (await forkModel.evaluate((element) => element === document.activeElement)) break
      await page.keyboard.press('ArrowDown')
    }
    await expect.poll(() => forkModel.evaluate((element) => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    await expect.poll(() => modelTrigger.getAttribute('aria-label')).toBe(`モデルを選択、現在 ${PROVIDER_TITLE} · ${MODEL_TITLE}`)
    await modelTrigger.press('Enter')
    await expect.poll(() => modelRow.isVisible()).toBe(true)
    await modelTrigger.press('Tab')
    await expect.poll(() => modelRow.evaluate((element) => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    const modelMenu = page.getByRole('group', { name: 'モデルと推論レベル', exact: true })
    await expect.poll(() => modelMenu.locator('[class*="providerValue"]').innerText()).toBe(PROVIDER_TITLE)

    await expect
      .poll(async () =>
        (await readPersistedEvents(scaffold, SessionId(PROJECT_SESSION))).some(
          (event) => event.type === 'model/selection' && event.data.provider === 'fork-gateway' && event.data.model === 'fork-model',
        ),
      )
      .toBe(true)
    const beforeEvents = await readPersistedEvents(scaffold, SessionId(PROJECT_SESSION))
    const expected = [
      '## Session list',
      await captureStableAria(page, '[role="tree"][aria-label="セッション"]', scaffold.workspaceCwd, { normalizeAge: true }),
      '## Composer',
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd, { normalizeAge: true }),
      '## Model selector',
      await modelMenu.ariaSnapshot(),
    ].join('\n\n')
    await compareOrRefreshGolden(EXPECTED, expected, MODE)
    await expect
      .poll(async () => JSON.stringify(await readPersistedEvents(scaffold, SessionId(PROJECT_SESSION))))
      .toBe(JSON.stringify(beforeEvents))

    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 900, height: 800 })
    const narrowLabels = await Promise.all([
      projectRow.locator('[class*="workspace"]').evaluate((element) => ({
        text: element.textContent,
        width: element.clientWidth,
        contentWidth: element.scrollWidth,
      })),
      modelTrigger.evaluate((element) => {
        const provider = element.querySelector<HTMLElement>('[class*="triggerProvider"]')
        const model = element.querySelector<HTMLElement>('[class*="triggerLabel"]')
        return {
          right: element.getBoundingClientRect().right,
          width: element.clientWidth,
          contentWidth: element.scrollWidth,
          providerWidth: provider?.clientWidth ?? 0,
          providerContentWidth: provider?.scrollWidth ?? 0,
          modelWidth: model?.clientWidth ?? 0,
          modelContentWidth: model?.scrollWidth ?? 0,
          accessibleName: element.getAttribute('aria-label'),
        }
      }),
      branchChip.evaluate((element) => {
        const label = element.querySelector<HTMLElement>('[class*="label"]')
        return {
          right: element.getBoundingClientRect().right,
          width: element.clientWidth,
          contentWidth: element.scrollWidth,
          labelWidth: label?.clientWidth ?? 0,
          labelContentWidth: label?.scrollWidth ?? 0,
          accessibleName: element.getAttribute('aria-label'),
        }
      }),
      page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      })),
    ])
    expect(narrowLabels[0].text).toBe(PROJECT_TITLE)
    expect(narrowLabels[0].contentWidth).toBeGreaterThan(narrowLabels[0].width)
    expect(narrowLabels[1].right).toBeLessThanOrEqual(900)
    expect(narrowLabels[1].contentWidth).toBeLessThanOrEqual(narrowLabels[1].width)
    expect(narrowLabels[1].providerContentWidth).toBeGreaterThan(narrowLabels[1].providerWidth)
    expect(narrowLabels[1].modelContentWidth).toBeGreaterThan(narrowLabels[1].modelWidth)
    expect(narrowLabels[1].accessibleName).toContain(`${PROVIDER_TITLE} · ${MODEL_TITLE}`)
    expect(narrowLabels[2].right).toBeLessThanOrEqual(900)
    expect(narrowLabels[2].contentWidth).toBeLessThanOrEqual(narrowLabels[2].width)
    expect(narrowLabels[2].labelContentWidth).toBeGreaterThan(narrowLabels[2].labelWidth)
    expect(narrowLabels[2].accessibleName).toContain(BRANCH_NAME)
    expect(narrowLabels[3].documentWidth).toBeLessThanOrEqual(narrowLabels[3].viewportWidth)

    const started = Promise.withResolvers<AbortSignal>()
    const cancellation = Promise.withResolvers<undefined>()
    const subprocess = scaffold.ctx.subprocess
    const originalSpawn = subprocess.spawn.bind(subprocess)
    const spawn = vi.spyOn(subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv[0] === 'git' && spec.argv[1] === '-C' && spec.argv[2] === projectCwd) {
        started.resolve(spec.signal ?? AbortSignal.abort(new Error('Host call omitted its signal')))
        return waitForAbort(spec, () => {
          cancellation.resolve(undefined)
        })
      }
      return originalSpawn(spec)
    })
    try {
      await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'))
      })
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
