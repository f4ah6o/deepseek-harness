import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it, vi } from 'vite-plus/test'
import { observeWebAppBoot, waitForWebAppFrame } from './support.ts'

const ARTIFACTS_DIR = fileURLToPath(new URL('../../../.artifacts/', import.meta.url))

describe('Web app boot failure diagnostics', () => {
  it('captures sanitized page evidence and preserves the original frame wait failure', async () => {
    const browser = await chromium.launch()
    const page = await browser.newPage({ locale: 'ja-JP' })
    const originalFailure = new Error('original frame wait failure')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const waitForSelector = vi.spyOn(page, 'waitForSelector').mockRejectedValue(originalFailure)
    const screenshot = vi.spyOn(page, 'screenshot')
    let screenshotPath: string | undefined

    try {
      observeWebAppBoot(page)
      await page.route('https://diagnostic.example.test/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/fixture') {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<html lang="ja"><body><div data-dsh-boot><div data-dsh-boot-spinner class="spinner" style="--dsh-boot-arc: 180deg"></div><div>Loading https://diagnostic.example.test/boot.js?token=private</div></div></body></html>',
          })
        } else if (pathname === '/failed') await route.abort()
        else {
          await route.fulfill({
            status: 503,
            headers: { 'access-control-allow-origin': '*' },
            body: 'unavailable',
          })
        }
      })
      await page.goto('https://diagnostic.example.test/fixture?token=private', { waitUntil: 'load' })

      const pageError = page.waitForEvent('pageerror', { timeout: 1_000 })
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error('Boot script failed at https://diagnostic.example.test/boot.js?token=private')
        }, 0)
      })
      await pageError
      await page.evaluate(async () => {
        await fetch('https://diagnostic.example.test/failed?token=private').catch(() => undefined)
        await fetch('https://diagnostic.example.test/unavailable?token=private').catch(() => undefined)
      })

      await expect(waitForWebAppFrame(page)).rejects.toBe(originalFailure)
      expect(waitForSelector).toHaveBeenCalledWith('[class*="frame"]', { timeout: 30_000 })
      expect(screenshot).toHaveBeenCalledTimes(1)
      const screenshotOptions = screenshot.mock.calls[0]?.[0]
      if (screenshotOptions === undefined) throw new Error('boot failure screenshot was not captured')
      screenshotPath = screenshotOptions.path
      expect(screenshotOptions.timeout).toBe(1_000)
      expect(screenshotPath).toContain(join(ARTIFACTS_DIR, `web-app-boot-${String(process.pid)}-`))
      expect(existsSync(screenshotPath!)).toBe(true)

      const reportText = consoleError.mock.calls[0]![1] as string
      const report = JSON.parse(reportText) as {
        document: {
          pathname: string
          documentReadyState: string
          locale: { document: string; browser: string; languages: string[] }
          bootText: string | null
          spinner: { className: string | null; style: string | null } | null
          frameCount: number
        }
        failedRequests: string[]
        failedResponses: { pathname: string; status: number }[]
        pageErrors: string[]
      }
      expect(report.document).toEqual({
        pathname: '/fixture',
        documentReadyState: 'complete',
        locale: { document: 'ja', browser: 'ja-JP', languages: ['ja-JP'] },
        bootText: 'Loading [url]',
        spinner: { className: 'spinner', style: '--dsh-boot-arc: 180deg' },
        frameCount: 0,
      })
      expect(report.failedRequests).toContain('/failed')
      expect(report.failedResponses).toContainEqual({ pathname: '/unavailable', status: 503 })
      expect(report.pageErrors).toContain('Boot script failed at [url]')
      expect(reportText).not.toContain('diagnostic.example.test')
      expect(reportText).not.toContain('token=private')
    } finally {
      waitForSelector.mockRestore()
      screenshot.mockRestore()
      consoleError.mockRestore()
      await page.close()
      await browser.close()
      if (screenshotPath !== undefined) await rm(screenshotPath, { force: true })
    }
  })
})
