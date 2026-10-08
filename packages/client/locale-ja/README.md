---
description: "Japanese (ja) language pack for the dsh web GUI: Japanese is the first-run default, with one typed dictionary for every active Client locale namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-locale-ja

English | [中文](README.zh.md)

## Summary

`dsh-client-locale-ja` adds Japanese to the web GUI and defaults new profiles to it when no language preference is saved. It registers a Japanese dictionary for every active Client namespace, so the interface switches without a reload; its empty node half exists only for Loader registration. Saved English and Chinese selections remain active. Uncovered dictionaries fall back to English. Removing the roster row removes Japanese from the selector and returns an active `ja` selection to the available locale.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The web-app bundle mounts the pack. A new profile opens in Japanese regardless of browser or operating-system language; an existing explicit English or Chinese selection remains unchanged. Settings → General → Language lets a user switch languages, and `<html lang>` follows the active locale (`ja`).

To drop Japanese, remove the `locale-ja` row from the web-app bundle's roster; the pack's contributions are disposed with the plugin fiber.

### Updating a translation

Every dictionary lives in `src/client/dicts/<namespace>.ts` and is declared as `LocaleDictOf<'<namespace>'>` with a type-only import of the owning package. A missing or extra key is a compile error, so an upstream key rename fails this package's build until the translation follows. A namespace the registry gains later surfaces in English until this pack ships a dictionary for it.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The pack is additive: it never edits the locale registry or another feature package.

### Registration

`apply` registers every dictionary through the per-locale `ctx.locale.register(ns, 'ja', dict)` form before adding the language definition with `ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en', default: true })`. The registry appends `ja` after the shipped `zh`/`en` pair, which fixes its position in the selector. Adding the definition after all dictionaries makes Japanese the default only when the pack is ready to render. A saved English or Chinese preference takes precedence. One owned effect disposes the language definition first, then the dictionaries, so no active Japanese render loses its translations during unload.

### Dictionary typing

`LocaleDictOf<N>` resolves the exact key union an owning package merged into `LocaleNamespaceMap`, so each dictionary is complete by construction. The type-only import loads the declaring module: the owner's dictionary module when it carries the `LocaleNamespaceMap` declaration itself, otherwise the owner's client entry that loads it (several owners declare it beside the registry, not beside the dictionary). A namespace whose owner declares no key union — `directory-browser` — is registered with the per-locale form and typed as `Record<string, string>`.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Language definition and dictionary registration effects |
| [`src/client/dicts/`](src/client/dicts/) | One Japanese dictionary per namespace plus the sorted registry list |
| [`src/index.ts`](src/index.ts) | Node half: empty apply so the Loader can mount the row |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [locale](../locale/README.md) — the registry this pack extends and the language-pack contract it implements.
- [ui-theme](../ui-theme/README.md) — the General settings rows the pack translates.
- [Client group map](../README.md) — the browser half this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

None, as the language pack registers translated UI copy and adds no model context or Session events.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the pack does not own and where upstream movement lands.

- **Upstream key changes stop the build, upstream additions do not** — a renamed or removed key fails typechecking here, while a namespace added upstream falls back to English until a dictionary is added.
- **Language packs own language-specific behavior** — the registry supplies selection, persistence, initial locale resolution, key fallback, and `<html lang>`; the pack carries no plural rules, bidirectional layout, or locale-aware formatting.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The pack's relationship to the registry is registration/disposal behavior asserted by its apply spec; there is no independent runtime source to compare against.
