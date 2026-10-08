# Changes

## Unreleased

### Added

### Changed

- DeepSeek Session-log request uploads now stay disabled until a user opts in.

### Fixed

### Deprecated

### Removed

### Security

### Migration

- Previously saved `enabled: true` values are reset once for each profile and the shared Harness home; users who want upload must opt in again. See the [upgrade guide](docs/upgrade-guide/v0.2.1-alpha.1/session-log-upload-default-off/guide.md).
