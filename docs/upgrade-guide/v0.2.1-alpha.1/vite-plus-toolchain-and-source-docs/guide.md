---
kind: upgrade-guide
description: "Contributor tooling moves to Vite Plus, and the VitePress documentation site is removed."
---

# Vite Plus and documentation source changes

English | [中文](guide.zh.md)

## Change

Repository build, test, lint, and formatting workflows use Vite Plus 1.1. The VitePress documentation site, its `docs:*` and `website:*` commands, and the repository's manual GitHub Pages workflow are removed. Markdown under `docs/` remains the maintained documentation source; documentation checks validate those files and do not generate a replacement site.

## Migration

1. Use Node.js `^22.19.0 || ^24.11.0 || >=26.0.0` and the repository-pinned pnpm `11.7.0`. The root package's declared engine range is unchanged; Vite Plus narrows the contributor toolchain range. CI tests Node 22.19, 24.11.1, and 26.
2. From the repository root, run `pnpm install --frozen-lockfile` to install the locked toolchain and dependencies.
3. Run `pnpm run build`, `pnpm run test`, and `pnpm run lint` for the normal contributor workflows. Use `pnpm run test:docs` to validate documentation source; it does not build a website. Confirm each command completes successfully before relying on the checkout.
4. Read and edit the Markdown source under `docs/`, starting with the [development guide](../../../development.md). The former VitePress and website scripts are no longer available.
