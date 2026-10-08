/** Native webview events controlled by each test; presentation and navigation stay real. */
import { vi } from 'vite-plus/test'
import type { Mock } from 'vite-plus/test'
import type { DesktopBrowserBridge, DesktopBrowserLeaseId, DesktopBrowserReservation } from '../src/types.ts'
import type { BrowserTabState } from '../src/client/browser/BrowserPersistence.ts'
import type { BrowserFrame } from '../src/client/browser/BrowserFrame.ts'
import { createElectronPage } from '../src/client/electron/pages.ts'
import { ElectronWebviewPresentation } from '../src/client/electron/ElectronWebviewPresentation.ts'
import type { WebviewElement } from '../src/client/electron/ElectronWebviewPresentation.ts'

interface GuestFixture {
  readonly element: WebviewElement
  readonly state: { url: string; title: string; loading: boolean; back: boolean; forward: boolean }
  readonly emit: (type: string, fields?: object) => void
  readonly loadURL: Mock<(url: string) => Promise<void>>
  readonly getURL: Mock<() => string>
  readonly getTitle: Mock<() => string>
  readonly canGoBack: () => boolean
  readonly canGoForward: () => boolean
  readonly clearHistory: Mock<() => void>
  readonly goBack: Mock<() => void>
  readonly goForward: Mock<() => void>
  readonly reload: Mock<() => void>
  readonly isLoading: () => boolean
}

interface ElectronFixture {
  readonly frame: BrowserFrame
  readonly presentation: ElectronWebviewPresentation
  readonly bridge: DesktopBrowserBridge & {
    readonly acquire: Mock<DesktopBrowserBridge['acquire']>
    readonly release: Mock<DesktopBrowserBridge['release']>
    readonly onOpenRequested: Mock<DesktopBrowserBridge['onOpenRequested']>
  }
  readonly workspace: Mock<(signal: AbortSignal) => Promise<string>>
  readonly persist: Mock<(state: BrowserTabState) => void>
  readonly openRequested: Mock<(url: string) => void>
  readonly opens: Set<(url: string) => void>
  readonly guests: GuestFixture[]
  readonly host: HTMLDivElement
  readonly reservation: DesktopBrowserReservation
  readonly mount: () => () => void
  readonly guest: () => Promise<GuestFixture>
  readonly dispose: () => Promise<void>
}

let sequence = 0

/** @returns one isolated, explicitly mounted page with native operations replaced by spies. */
export function electronFixture(initial?: BrowserTabState): ElectronFixture {
  const opens = new Set<(url: string) => void>()
  const reservation: DesktopBrowserReservation = { lease: `lease-${++sequence}` as DesktopBrowserLeaseId, partition: 'partition' }
  const bridge = {
    acquire: vi.fn(async (_workspace: string) => reservation),
    release: vi.fn(async (_lease: DesktopBrowserLeaseId) => {}),
    onOpenRequested: vi.fn((_lease: DesktopBrowserLeaseId, listener: (url: string) => void) => {
      opens.add(listener)
      return () => {
        opens.delete(listener)
      }
    }),
  } satisfies DesktopBrowserBridge
  const workspace = vi.fn(async (_signal: AbortSignal) => 'cwd:/workspace')
  const persist = vi.fn()
  const openRequested = vi.fn()
  const page = createElectronPage({ initial, persist, openRequested }, bridge, workspace)
  const presentation = page.presentation
  if (!(presentation instanceof ElectronWebviewPresentation)) throw new Error('expected the Electron presentation')
  const create = presentation.createElement.bind(presentation)
  const guests: GuestFixture[] = []
  function prepareGuest(approved: DesktopBrowserReservation) {
    const element = create(approved)
    const state = { url: 'about:blank', title: '', loading: true, back: false, forward: false }
    const methods = {
      loadURL: vi.fn(async (_url: string) => {}),
      getURL: vi.fn(() => state.url),
      getTitle: vi.fn(() => state.title),
      canGoBack: () => state.back,
      canGoForward: () => state.forward,
      clearHistory: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      isLoading: () => state.loading,
    }
    Object.assign(element, methods)
    const emit = (type: string, fields: object = {}): void => {
      element.dispatchEvent(Object.assign(new Event(type), fields))
    }
    return { element, state, emit, ...methods }
  }
  const createElement = vi.spyOn(presentation, 'createElement').mockImplementation((approved) => {
    const guest = prepareGuest(approved)
    guests.push(guest)
    return guest.element
  })
  const host = document.createElement('div')
  host.id = `electron-fixture-${sequence}`
  document.body.append(host)
  return {
    ...page,
    presentation,
    bridge,
    workspace,
    persist,
    openRequested,
    opens,
    guests,
    host,
    reservation,
    mount: () => presentation.mount(host.id),
    async guest() {
      await vi.waitFor(() => {
        expectGuest()
      })
      return guests.at(-1)!
    },
    async dispose() {
      await page.frame.dispose()
      createElement.mockRestore()
      host.remove()
    },
  }
  function expectGuest(): void {
    if (host.firstElementChild === null || guests.length === 0) throw new Error('guest has not attached')
  }
}
