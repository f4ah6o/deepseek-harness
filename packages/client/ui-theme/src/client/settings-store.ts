/**
 * Appearance and font-size row slot stores: mirrors of the theme service
 * snapshot. The plugin's apply-world change listener is the only writer; the
 * row components read via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILIES, type FontFamilySelections, type ThemePreference } from '../theme-settings.ts'

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Persisted preference (selection state reads this, never the resolved active theme). */
  preference: ThemePreference
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (draft: AppearanceRowState, preference: ThemePreference, revision: number) => void
}

/**
 * Declares the Appearance row state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({ preference: 'system', revision: -1 }),
    actions: {
      sync: (d, preference: ThemePreference, revision: number) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.revision = revision
      },
    },
  })
}

/** Font presets accepted by the settings scope. */
export interface FontFamilyRowState {
  /** Selected presets by use. */
  fontFamilies: FontFamilySelections
  /** Service revision; -1 until the first sync. */
  revision: number
}

type FontFamilyRowActions = {
  sync: (draft: FontFamilyRowState, fontFamilies: FontFamilySelections, revision: number) => void
}

/**
 * Declare the font dropdowns' shared state.
 * @returns the store handle mirrored from accepted theme settings.
 */
export function createFontFamilyRowStore(): EngineStoreHandle<FontFamilyRowState, FontFamilyRowActions> {
  return defineStore({
    init: (): FontFamilyRowState => ({ fontFamilies: DEFAULT_FONT_FAMILIES, revision: -1 }),
    actions: {
      sync: (draft, fontFamilies: FontFamilySelections, revision: number) => {
        if (revision <= draft.revision) return
        draft.fontFamilies = fontFamilies
        draft.revision = revision
      },
    },
  })
}

/** Store state mirrored from the theme snapshot's font size. */
export interface FontSizeRowState {
  /** Persisted content font size in px. */
  fontSize: number
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FontSizeRowActions = {
  sync: (draft: FontSizeRowState, fontSize: number, revision: number) => void
}

/**
 * Declares the font-size row state and write surface.
 * @returns the store handle.
 */
export function createFontSizeRowStore(): EngineStoreHandle<FontSizeRowState, FontSizeRowActions> {
  return defineStore({
    init: (): FontSizeRowState => ({ fontSize: DEFAULT_FONT_SIZE, revision: -1 }),
    actions: {
      sync: (d, fontSize: number, revision: number) => {
        if (revision <= d.revision) return
        d.fontSize = fontSize
        d.revision = revision
      },
    },
  })
}
