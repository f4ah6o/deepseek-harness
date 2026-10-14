/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 10

/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 22

/** Content font size when the user-settings document has no override (px). */
export const DEFAULT_FONT_SIZE = 14

/** Independently configurable font uses. */
export const FONT_ROLES = ['text', 'code', 'terminal'] as const

/** One font setting: interface text, code, or the sidebar terminal. */
export type FontRole = (typeof FONT_ROLES)[number]

/** Font presets offered by the settings dropdowns. */
export type FontFamilyPreset =
  | 'default'
  | 'meiryo'
  | 'yu-gothic'
  | 'hiragino-sans'
  | 'noto-sans-jp'
  | 'noto-serif-jp'
  | 'consolas'
  | 'menlo'
  | 'ms-gothic'
  | 'osaka-mono'
  | 'noto-sans-mono-jp'
  | 'jetbrains-mono'

/** Preset identity and its installed-system CSS families. */
export interface FontFamilyChoice {
  /** Persisted preset identity. */
  id: FontFamilyPreset
  /** Families placed before the built-in fallback stack; empty for the default. */
  family: string
}

const PROPORTIONAL_FONT_CHOICES = [
  { id: 'default', family: '' },
  { id: 'meiryo', family: 'Meiryo' },
  { id: 'yu-gothic', family: '"Yu Gothic UI", "Yu Gothic"' },
  { id: 'hiragino-sans', family: '"Hiragino Sans"' },
  { id: 'noto-sans-jp', family: '"Noto Sans JP", "Noto Sans CJK JP"' },
  { id: 'noto-serif-jp', family: '"Noto Serif JP", "Noto Serif CJK JP"' },
] as const satisfies readonly FontFamilyChoice[]

const MONOSPACE_FONT_CHOICES = [
  { id: 'default', family: '' },
  { id: 'consolas', family: 'Consolas' },
  { id: 'menlo', family: 'Menlo' },
  { id: 'ms-gothic', family: '"MS Gothic"' },
  { id: 'osaka-mono', family: '"Osaka-Mono"' },
  { id: 'noto-sans-mono-jp', family: '"Noto Sans Mono CJK JP"' },
  { id: 'jetbrains-mono', family: '"JetBrains Mono"' },
] as const satisfies readonly FontFamilyChoice[]

/** Supported presets by use; code and terminal offer only monospace presets. */
export const FONT_FAMILY_CHOICES = {
  text: PROPORTIONAL_FONT_CHOICES,
  code: MONOSPACE_FONT_CHOICES,
  terminal: MONOSPACE_FONT_CHOICES,
} as const satisfies Record<FontRole, readonly FontFamilyChoice[]>

/** Settings fields carrying font preset identities. */
export const FONT_FAMILY_FIELDS = {
  text: 'textFontFamily',
  code: 'codeFontFamily',
  terminal: 'terminalFontFamily',
} as const

/** Font preset identities by use. */
export type FontFamilySelections = Readonly<Record<FontRole, FontFamilyPreset>>

/** Built-in fallback selection for every use. */
export const DEFAULT_FONT_FAMILIES: FontFamilySelections = Object.freeze({ text: 'default', code: 'default', terminal: 'default' })

/**
 * Validate one role's persisted preset.
 * @param role - font use.
 * @returns the schema accepting supported presets and defaulting missing settings.
 */
export function fontFamilySchema(role: FontRole): z<FontFamilyPreset> {
  return z.union(FONT_FAMILY_CHOICES[role].map((choice) => choice.id)).default('default')
}

/**
 * Check a preset received from a setting or bootstrap attribute.
 * @param role - font use.
 * @param value - candidate preset identity.
 * @returns whether the role supports the preset.
 */
export function isFontFamilyPreset(role: FontRole, value: string): value is FontFamilyPreset {
  return FONT_FAMILY_CHOICES[role].some((choice) => choice.id === value)
}

/**
 * Resolve font selections into body-scoped variables, retaining installed-system fallbacks.
 * @param selections - validated presets by use.
 * @returns variables for non-default presets; default choices inherit the built-in stack.
 */
export function fontFamilyTokens(selections: FontFamilySelections): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const role of FONT_ROLES) {
    const choice = FONT_FAMILY_CHOICES[role].find((item) => item.id === selections[role])
    if (choice === undefined) throw new Error('unsupported font preset for ' + role)
    if (choice.id === 'default') continue
    const fallback = role === 'text' ? '--dsh-fallback-text-font-family' : '--dsh-fallback-code-font-family'
    tokens['--dsh-font-family-' + role] = choice.family + ', var(' + fallback + ')'
  }
  return tokens
}

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Conversation content font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  fontSize: number
  /** Interface font preset; default keeps the built-in system stack. */
  textFontFamily?: FontFamilyPreset
  /** Code font preset; default keeps the built-in code stack. */
  codeFontFamily?: FontFamilyPreset
  /** Terminal font preset; default follows the shared code stack. */
  terminalFontFamily?: FontFamilyPreset
}

/**
 * Resolve absent font preferences to the built-in stacks.
 * @param settings - accepted theme settings, with optional font overrides.
 * @returns immutable preset selections for every use.
 */
export function resolveFontFamilySelections(settings: ThemeSettings): FontFamilySelections {
  return Object.freeze({
    text: settings.textFontFamily ?? 'default',
    code: settings.codeFontFamily ?? 'default',
    terminal: settings.terminalFontFamily ?? 'default',
  })
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
  [FONT_FAMILY_FIELDS.text]: fontFamilySchema('text'),
  [FONT_FAMILY_FIELDS.code]: fontFamilySchema('code'),
  [FONT_FAMILY_FIELDS.terminal]: fontFamilySchema('terminal'),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value)
}
