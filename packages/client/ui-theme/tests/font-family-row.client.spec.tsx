// @vitest-environment jsdom
/** Font-family row behavior with real slot stores and the shared portaled Menu. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FontFamilyRow, type FontFamilyRowComponentProps } from '../src/client/FontFamilyRow.tsx'
import { createFontFamilyRowStore } from '../src/client/settings-store.ts'
import { en, zh, type ThemeKey } from '../src/client/locales.ts'
import { ja } from '../../locale-ja/src/client/dicts/settings-theme.ts'
import { en as commonEn } from '../../locale/src/locales/en.ts'
import type { FontFamilySelections, FontRole } from '../src/theme-settings.ts'

const useResource = (() => ({
  status: 'none' as const,
  value: undefined,
  failure: undefined,
  reload: () => {},
})) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = (selector) => selector({ activePanelId: null })
type AttentionSnapshot = Parameters<Parameters<FontFamilyRowComponentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: FontFamilyRowComponentProps['useSessionStatus'] = (selector) => selector(noAttention)

const DEFAULTS: FontFamilySelections = { text: 'default', code: 'default', terminal: 'default' }
const TEXT_LABELS = ['System default', 'Meiryo', 'Yu Gothic', 'Hiragino Sans', 'Noto Sans JP', 'Noto Serif JP']
const MONO_LABELS = ['System default', 'Consolas', 'Menlo', 'MS Gothic', 'Osaka Mono', 'Noto Sans Mono JP', 'JetBrains Mono']

afterEach(cleanup)

function emptySessions() {
  return bindSnapshotSelector(
    createSnapshotStore<SessionListState>({
      ids: [],
      byId: {},
      phase: 'ready',
      projectionsBySession: {},
    }),
  )
}

function emptyWorkspaces() {
  return bindSnapshotSelector(
    createSnapshotStore<WorkspaceSnapshot>({
      items: [],
      archivedSessionIds: [],
      pinnedSessionIds: [],
      state: 'idle',
      phase: 'ready',
      error: null,
    }),
  )
}

function translate(copy: Record<ThemeKey, string>): FontFamilyRowComponentProps['t'] {
  const dictionary = { ...commonEn, ...copy }
  return (key) => dictionary[key]
}

function mount(role: FontRole = 'text', fontFamilies = DEFAULTS, copy: Record<ThemeKey, string> = en) {
  const store = createFontFamilyRowStore().create()
  store.actions.sync(fontFamilies, 0)
  const setFontFamily = vi.fn()
  const props: FontFamilyRowComponentProps = {
    role,
    setFontFamily,
    useSessions: emptySessions(),
    useSessionStatus,
    useSessionRetainInfo: () => undefined,
    usePanelInfo,
    useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: translate(copy),
  }
  const view = render(<FontFamilyRow {...props} />)
  return { ...view, props, store, setFontFamily }
}

function trigger(name: string) {
  return screen.getByRole('button', { name })
}

function hasCheck(label: string) {
  return screen.getByRole('menuitem', { name: label }).querySelector('svg') !== null
}

describe('FontFamilyRow', () => {
  it.each([
    ['text', 'Text font', TEXT_LABELS],
    ['code', 'Code font', MONO_LABELS],
    ['terminal', 'Terminal font', MONO_LABELS],
  ] as const)('renders the %s role title, fallback description, and only its choices', (role, title, labels) => {
    mount(role)
    expect(screen.getByText(title)).toBeDefined()
    expect(screen.getByText(en[`fontFamily.${role}.description`])).toBeDefined()
    const anchor = trigger(title + ' System default')
    expect(anchor.getAttribute('aria-haspopup')).toBe('menu')
    expect(anchor.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(anchor)
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(labels)
    expect(hasCheck('System default')).toBe(true)
    for (const label of labels.slice(1)) expect(hasCheck(label)).toBe(false)
  })

  it('portals the menu out of its row and keeps inside pointer interactions open', () => {
    const view = mount()
    fireEvent.click(trigger('Text font System default'))
    const menu = screen.getByRole('menu')
    expect(document.body.contains(menu)).toBe(true)
    expect(view.container.contains(menu)).toBe(false)
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Meiryo' }))
    expect(screen.getByRole('menu')).toBe(menu)
    expect(view.setFontFamily).not.toHaveBeenCalled()
  })

  it('calls back with the preset ID and waits for the store before changing the label or check', () => {
    const families: FontFamilySelections = { text: 'meiryo', code: 'menlo', terminal: 'consolas' }
    const view = mount('text', families)
    const anchor = trigger('Text font Meiryo')
    fireEvent.click(anchor)
    expect(hasCheck('Meiryo')).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Noto Sans JP' }))
    expect(view.setFontFamily).toHaveBeenCalledExactlyOnceWith('noto-sans-jp')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(anchor.getAttribute('aria-expanded')).toBe('false')
    expect(trigger('Text font Meiryo')).toBe(anchor)
    fireEvent.click(anchor)
    expect(hasCheck('Meiryo')).toBe(true)
    expect(hasCheck('Noto Sans JP')).toBe(false)
    act(() => {
      view.store.actions.sync({ ...families, text: 'noto-sans-jp' }, 1)
    })
    expect(trigger('Text font Noto Sans JP')).toBe(anchor)
    expect(hasCheck('Noto Sans JP')).toBe(true)
    expect(hasCheck('Meiryo')).toBe(false)
  })

  it('can select the default preset without changing other role selections', () => {
    const view = mount('code', { text: 'meiryo', code: 'menlo', terminal: 'consolas' })
    fireEvent.click(trigger('Code font Menlo'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'System default' }))
    expect(view.setFontFamily).toHaveBeenCalledExactlyOnceWith('default')
    expect(view.store.getSnapshot().fontFamilies).toEqual({ text: 'meiryo', code: 'menlo', terminal: 'consolas' })
  })

  it('dismisses on outside pointerdown or another trigger click without selecting', () => {
    const view = mount()
    const anchor = trigger('Text font System default')
    fireEvent.click(anchor)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(anchor.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(anchor)
    fireEvent.click(anchor)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(view.setFontFamily).not.toHaveBeenCalled()
  })

  it.each(['Escape', 'Tab'])('dismisses with %s and restores trigger focus without selecting', (key) => {
    const view = mount()
    const anchor = trigger('Text font System default')
    anchor.focus()
    fireEvent.click(anchor)
    const first = screen.getByRole('menuitem', { name: 'System default' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key, shiftKey: key === 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(anchor)
    expect(view.setFontFamily).not.toHaveBeenCalled()
  })

  it('walks choices with Arrow keys, Home, and End, then selects with Tab', async () => {
    const view = mount()
    const anchor = trigger('Text font System default')
    anchor.focus()
    fireEvent.click(anchor)
    const first = screen.getByRole('menuitem', { name: 'System default' })
    const second = screen.getByRole('menuitem', { name: 'Meiryo' })
    const last = screen.getByRole('menuitem', { name: 'Noto Serif JP' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'End' })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Home' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(view.setFontFamily).toHaveBeenCalledExactlyOnceWith('noto-serif-jp')
    expect(screen.queryByRole('menu')).toBeNull()
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.activeElement).toBe(anchor)
  })

  it.each([
    ['English', en, 'Text font Meiryo', 'Yu Gothic'],
    ['Chinese', zh, '文本字体 Meiryo', 'Yu Gothic'],
    ['Japanese', ja, 'テキストフォント メイリオ', '游ゴシック'],
  ] as const)('uses %s copy for the role, description, options, and accessible label', (_locale, copy, name, next) => {
    const view = mount('text', { ...DEFAULTS, text: 'meiryo' }, copy)
    expect(screen.getByText(copy['fontFamily.text.description'])).toBeDefined()
    fireEvent.click(trigger(name))
    expect(screen.getByRole('menuitem', { name: copy['fontFamily.option.default'] })).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: next }))
    expect(view.setFontFamily).toHaveBeenCalledExactlyOnceWith('yu-gothic')
  })

  it('updates localized labels in an open menu without changing the selected preset', () => {
    const view = mount('text', { ...DEFAULTS, text: 'meiryo' })
    fireEvent.click(trigger('Text font Meiryo'))
    view.rerender(<FontFamilyRow {...view.props} t={translate(ja)} />)
    expect(trigger('テキストフォント メイリオ')).toBeDefined()
    expect(hasCheck('メイリオ')).toBe(true)
    expect(screen.getByRole('menuitem', { name: '游ゴシック' })).toBeDefined()
    expect(view.setFontFamily).not.toHaveBeenCalled()
  })
})
