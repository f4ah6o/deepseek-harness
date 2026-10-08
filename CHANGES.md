# Changes

## Unreleased

### Added

- Japanese UI dictionaries and Desktop menus, dialogs, recovery, and update messages.
- Project names above flat Session titles, provider names beside the selected model, and repository/branch context below the composer.
- The `workspaceGit.status(SessionId)` API for the Session working directory, with configurable refresh and request deadlines.

### Changed

- DeepSeek Session-log request uploads now stay disabled until a user opts in.
- Web and Desktop start in Japanese when no language preference is saved; saved English and Chinese choices remain selected.
- Contributor builds, tests, and lint now use Vite Plus 1.1. See the [toolchain migration guide](docs/upgrade-guide/v0.2.1-alpha.1/vite-plus-toolchain-and-source-docs/guide.md).

### Fixed

### Deprecated

### Removed

- Removed the VitePress documentation site, its `docs:*` and `website:*` commands, and the repository's manual GitHub Pages deployment workflow; documentation remains maintained as Markdown under `docs/`.

### Security

### Migration

- Use a Vite+ compatible Node.js version and the root contributor commands for builds, tests, and lint; use Markdown under `docs/` as the documentation source. See the [toolchain migration guide](docs/upgrade-guide/v0.2.1-alpha.1/vite-plus-toolchain-and-source-docs/guide.md).
- Previously saved `enabled: true` values are reset once for each profile and the shared Harness home; users who want upload must opt in again. See the [upgrade guide](docs/upgrade-guide/v0.2.1-alpha.1/session-log-upload-default-off/guide.md).
- Select English or Chinese in language settings to override the Japanese default. See the [language guide](docs/upgrade-guide/v0.2.1-alpha.1/japanese-language-default/guide.md).
