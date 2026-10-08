/**
 * Browser half of the Japanese language pack: registers the `ja` language
 * definition and one Japanese dictionary per shipped namespace over the locale
 * registry the `@deepseek-ai/dsh-client-locale` service owns. Keys a dictionary
 * does not carry fall back through the language's declared `en` chain, so a
 * namespace added upstream surfaces untranslated rather than blank.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { DICTIONARIES } from './dicts/index.ts'

/** Required service: the locale registry this pack contributes to. */
export const inject = ['locale']

/**
 * Client plugin body: register all dictionaries before exposing Japanese in the
 * language selector, so the first Japanese render has translations available.
 * Unload and HMR remove exactly this pack's contributions.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    let removeLanguage: (() => void) | undefined
    try {
      for (const { ns, dict } of DICTIONARIES) disposers.push(ctx.locale.register(ns, 'ja', dict))
      removeLanguage = ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en', default: true })
    } catch (error) {
      removeLanguage?.()
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => {
      removeLanguage()
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'locale-ja: language and dictionaries')
}
