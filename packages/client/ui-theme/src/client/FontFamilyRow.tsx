/** Font-family preference row; selection follows the theme store, not the click echo. */
import { useId, useState } from 'react'
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { FONT_FAMILY_CHOICES, type FontFamilyPreset, type FontRole } from '../theme-settings.ts'
import type { createFontFamilyRowStore } from './settings-store.ts'
import css from './FontFamilyRow.module.css'

/** Font role and preference write supplied by the registration. */
export interface FontFamilyRowInjected {
  /** Text, code, or terminal font controlled by this row. */
  role: FontRole
  /** Change this role's font-family preset. */
  setFontFamily: (preset: FontFamilyPreset) => void
}

/** General settings row props with the font-family store and localized copy. */
export type FontFamilyRowComponentProps = PropsRuntime<'settings.general.item'> &
  PropsLocale<'settings.theme'> &
  PropsStore<ReturnType<typeof createFontFamilyRowStore>> &
  FontFamilyRowInjected

/**
 * Render one role's font-family dropdown.
 * @param props - composed General settings slot props.
 * @returns the labeled row and portaled selection menu.
 */
export function FontFamilyRow({ role, setFontFamily, t, useStore }: FontFamilyRowComponentProps) {
  const selected = useStore((state) => state.fontFamilies[role])
  const [open, setOpen] = useState(false)
  const rowId = useId()
  const choices = FONT_FAMILY_CHOICES[role]

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div id={rowId + '-title'} className={css.title}>
          {t(`fontFamily.${role}.title`)}
        </div>
        <div id={rowId + '-description'} className={css.desc}>
          {t(`fontFamily.${role}.description`)}
        </div>
      </div>
      <Menu
        open={open}
        autoFocus
        portal
        align="end"
        className={css.menu}
        listClassName={css.list}
        onClose={() => {
          setOpen(false)
        }}
        items={choices.map((choice) => ({ id: choice.id, label: t(`fontFamily.option.${choice.id}`) }))}
        selectedId={selected}
        onSelect={(id) => {
          setOpen(false)
          setFontFamily(id as FontFamilyPreset)
        }}
        anchor={
          <Button
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-labelledby={rowId + '-title ' + rowId + '-selection'}
            aria-describedby={rowId + '-description'}
            onClick={() => {
              setOpen((value) => !value)
            }}
          >
            <span id={rowId + '-selection'} className={css.selectedLabel}>
              {t(`fontFamily.option.${selected}`)}
            </span>
            <IconChevronDownOutlineRegular className={css.chevron} />
          </Button>
        }
      />
    </div>
  )
}
