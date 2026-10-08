---
kind: upgrade-guide
description: "DeepSeek Session-log uploads become opt-in, and existing saved opt-ins reset once."
---

# Session-log upload becomes opt-in

English | [中文](guide.zh.md)

## Change

DeepSeek Session-log uploads are disabled by default in every profile. The Web switch or an explicit `enabled: true` patch opts in. An explicit `--patch` overlay remains unchanged and applies to that launch.

On first startup after upgrading, the launcher resets a saved `enabled: true` in the active profile's `cordis.patch.yml` to `false`. It also removes `enabled: true` from `$DSH_HOME/cordis.patch.yml` so the home layer does not shadow a later profile opt-in, and changes a legacy `session-log-deepseek.enabled: true` in `$DSH_HOME/settings.yaml` to `false` before Settings imports it. Other patch fields remain in place. OTel feedback upload has a separate setting and is unchanged.

## Migration

1. Start each profile that has a saved upload setting once. The shared home and legacy settings migrate on the first profile launch; each profile's saved opt-in migrates when that profile first launches.
2. To use the Web switch, remove any remaining `config` from the home `session-log-deepseek` entry first; the home config replaces the profile config. Then enable **Settings → General → Upload Session Log when using the official model API**. You can also set `enabled: true` in the home or profile `cordis.patch.yml`, or use a `--patch` overlay to opt in for one launch without changing saved files.
3. Confirm the Web switch is on or the intended patch layer contains `enabled: true`, then restart the profile. The setting remains enabled after migration completes.
