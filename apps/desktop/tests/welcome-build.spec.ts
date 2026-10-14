/** Render the Welcome bundle produced by the Desktop build. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vite-plus/test'
import { buildWelcomeRenderer } from '../scripts/build-welcome-renderer.ts'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { WelcomeApi } from '../src/welcome-api.ts'

it('renders the production Welcome bundle with its isolated preload API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-welcome-build-'))
  let dom: JSDOM | undefined
  try {
    await buildWelcomeRenderer(directory)
    dom = new JSDOM(await readFile(new URL('../renderer/welcome.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
    const signedOut: AccountView = { status: 'signed-out', attempt: null, links: { usageUrl: '', topUpUrl: '' } }
    const api: WelcomeApi = {
      ...resolveDesktopLocale('en'),
      analyticsEnabled: async () => false,
      takeNotice: async () => undefined,
      onAccountState: () => () => {},
      startSignIn: async () => signedOut,
      cancelSignIn: async () => signedOut,
      copySignInLink: async () => {},
      saveApiKey: async () => ({ ok: true }),
      skip: async () => {},
    }
    Object.defineProperties(dom.window, {
      dshWelcome: { value: api },
      matchMedia: { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    })
    runInContext(await readFile(join(directory, 'welcome.js'), 'utf8'), dom.getInternalVMContext())
    const document = dom.window.document
    expect(document.getElementById('root')?.childElementCount).toBeGreaterThan(0)
    expect(document.getElementById('sign-in')?.textContent).toBe(api.messages.welcomeSignIn)
    expect(document.getElementById('api-key')?.textContent).toBe(api.messages.welcomeApiKey)
  } finally {
    if (dom !== undefined) {
      dom.window.dispatchEvent(new dom.window.Event('pagehide'))
      dom.window.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
})
