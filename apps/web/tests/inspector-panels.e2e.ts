/** Real packaged DevTools panels against an isolated Web Host. */
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFinished } from 'vite-plus/test'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { removeDiagnosticUrls, safeRequestPathname } from './support.ts'

let browser: Browser | undefined
let scaffold: WebScaffold | undefined
const DIAGNOSTIC_READ_MS = 1_000
let failureScreenshotSequence = 0

type DiagnosticRead<T> =
  | { readonly status: 'resolved'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: string }
  | { readonly status: 'timed out' }

async function readDiagnostic<T>(work: Promise<T>): Promise<DiagnosticRead<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work.then<DiagnosticRead<T>, DiagnosticRead<T>>(
        (value) => ({ status: 'resolved', value }),
        (error: unknown) => ({
          status: 'rejected',
          error: removeDiagnosticUrls(error instanceof Error ? error.message : String(error)).slice(0, 500),
        }),
      ),
      new Promise<DiagnosticRead<T>>((resolve) => {
        timer = setTimeout(() => resolve({ status: 'timed out' }), DIAGNOSTIC_READ_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

beforeAll(async () => {
  scaffold = await launchWebScaffold({
    profile: {
      packages: [
        {
          dir: fileURLToPath(new URL('../../../packages/experimental/inspector-profile', import.meta.url)),
          enabled: true,
        },
      ],
      hmr: false,
    },
    extraOverlayPath: [
      fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
      fileURLToPath(new URL('./fixtures/shared-inspector.patch.yml', import.meta.url)),
    ],
  })
  browser = await chromium.launch()
})

afterAll(async () => {
  try {
    await browser?.close()
  } finally {
    await scaffold?.close()
  }
})

it.each(['Elements', 'Memory', 'Performance'] as const)('uses the %s panel against the Host', async (panel) => {
  const page = await browser!.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } })
  onTestFinished(() => page.close())
  const errors: string[] = []
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  const responses: string[] = []
  const requests = new Map<number, string>()
  const methods: string[] = []
  const completed = new Set<string>()
  let heapChunks = 0
  page.on('pageerror', (error) => pageErrors.push(removeDiagnosticUrls(error.message).slice(0, 500)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(removeDiagnosticUrls(message.text()).slice(0, 500))
  })
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown failure'
    failedRequests.push(`${request.method()} ${safeRequestPathname(request.url())}: ${removeDiagnosticUrls(reason)}`)
  })
  page.on('response', (response) => {
    const path = safeRequestPathname(response.url())
    if (response.request().resourceType() === 'document' || path.includes('/inspector/devtools/')) {
      responses.push(`${response.status()} ${response.request().method()} ${response.request().resourceType()} ${path}`)
    }
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${path}`)
  })
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/inspector/devtools/cdp')) return
    socket.on('framesent', ({ payload }) => {
      const message = JSON.parse(String(payload)) as { id: number; method: string }
      requests.set(message.id, message.method)
      methods.push(message.method)
    })
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload)) as { id?: number; method?: string; error?: { message: string } }
      if (message.method === 'HeapProfiler.addHeapSnapshotChunk') heapChunks++
      if (message.error !== undefined) {
        errors.push(removeDiagnosticUrls(`${requests.get(message.id!)}: ${message.error.message}`).slice(0, 500))
      } else if (message.id !== undefined && requests.has(message.id)) completed.add(requests.get(message.id)!)
    })
  })
  await page.goto(scaffold!.authenticatedUrl, { waitUntil: 'load' })
  const frontend = new URL('inspector/devtools/devtools_app.html?disableLocaleInfoBar=true', scaffold!.baseUrl)
  await page.goto(frontend.href, { waitUntil: 'load' })
  try {
    await page.getByRole('tab', { name: panel, exact: true }).click()
    if (panel === 'Elements') {
      const host = page
        .locator('.webkit-html-tag-name')
        .filter({ hasText: /^host$/u })
        .first()
      await host.waitFor({ state: 'visible' })
      await host.dblclick()
      await page
        .locator('.webkit-html-tag-name')
        .filter({ hasText: /^context$/iu })
        .first()
        .waitFor({ state: 'visible' })
    } else if (panel === 'Memory') {
      await page.getByRole('button', { name: 'Take snapshot', exact: true }).click()
      await page.getByRole('columnheader', { name: /^Constructor/u }).waitFor({ state: 'visible' })
      await expect.poll(() => page.getByRole('table').first().getByRole('row').count(), { timeout: 30_000 }).toBeGreaterThan(1)
      expect(heapChunks).toBeGreaterThan(0)
      expect(completed.has('HeapProfiler.takeHeapSnapshot')).toBe(true)
    } else {
      await page
        .getByRole('button', { name: /^Record(?:$| )/u })
        .first()
        .click()
      await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'visible' })
      await expect.poll(() => completed.has('Profiler.start')).toBe(true)
      let value = 0
      for (let index = 0; index < 5_000_000; index++) value += Math.sqrt(index)
      expect(value).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Stop', exact: true }).click()
      await page.getByRole('tab', { name: 'Bottom-up', exact: true }).waitFor({ state: 'visible' })
      expect(completed.has('Profiler.stop')).toBe(true)
    }
  } catch (error) {
    const baseState = {
      panel,
      errors: errors.slice(-100),
      pageErrors: pageErrors.slice(-100),
      consoleErrors: consoleErrors.slice(-100),
      failedRequests: failedRequests.slice(-100),
      responses: responses.slice(-100),
      methods: methods.slice(-200),
      heapChunks,
      path: safeRequestPathname(page.url()),
    }
    let failureState: unknown = baseState
    try {
      const document = await readDiagnostic(
        page.evaluate(() => ({
          readyState: window.document.readyState,
          title: window.document.title,
          bodyText: window.document.body?.innerText.slice(0, 1_000) ?? '',
          bodyHtml: window.document.body?.innerHTML.slice(0, 1_000) ?? '',
          scripts: [...window.document.scripts].map((script) => {
            if (script.src.length === 0) return 'inline'
            try {
              return new URL(script.src).pathname
            } catch (urlError) {
              const reason = urlError instanceof Error ? urlError.name : 'unknown URL error'
              return `[invalid script URL: ${reason}]`
            }
          }),
        })),
      )
      let screenshot = 'unavailable'
      let screenshotError: string | undefined
      try {
        screenshot = join(tmpdir(), `dsh-inspector-panels-${process.pid}-${++failureScreenshotSequence}-${panel.toLowerCase()}.png`)
        await page.screenshot({ path: screenshot, timeout: 1_000 })
      } catch (captureError) {
        screenshot = 'capture failed'
        screenshotError = removeDiagnosticUrls(captureError instanceof Error ? captureError.message : String(captureError)).slice(0, 300)
      }
      const aria = await readDiagnostic(page.locator('body').ariaSnapshot())
      const safeDocument =
        document.status !== 'resolved'
          ? document
          : {
              status: document.status,
              value: {
                ...document.value,
                title: removeDiagnosticUrls(document.value.title).slice(0, 500),
                bodyText: removeDiagnosticUrls(document.value.bodyText).slice(0, 1_000),
                bodyHtml: removeDiagnosticUrls(document.value.bodyHtml).slice(0, 1_000),
              },
            }
      const safeAria = aria.status === 'resolved' ? removeDiagnosticUrls(aria.value).slice(0, 2_000) : aria
      failureState = {
        ...baseState,
        document: safeDocument,
        screenshot,
        ...(screenshotError === undefined ? {} : { screenshotError }),
        aria: safeAria,
      }
    } catch (captureError) {
      failureState = {
        ...baseState,
        diagnosticCaptureError: removeDiagnosticUrls(captureError instanceof Error ? captureError.message : String(captureError)).slice(
          0,
          500,
        ),
      }
    }
    let diagnosticText = 'Inspector failure diagnostics unavailable'
    try {
      diagnosticText = JSON.stringify(failureState)
    } catch (serializationError) {
      diagnosticText = `Inspector failure diagnostics could not serialize: ${serializationError instanceof Error ? serializationError.name : 'unknown error'}`
    }
    throw new Error(diagnosticText, { cause: error })
  }
})
