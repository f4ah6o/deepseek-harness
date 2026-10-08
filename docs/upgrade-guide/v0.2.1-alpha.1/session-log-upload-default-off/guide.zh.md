---
kind: upgrade-guide
description: "DeepSeek 会话日志上传改为显式开启，已有的保存选项会重置一次。"
---

# 会话日志上传改为显式开启

[English](guide.md) | 中文

## 变更

所有 profile 中的 DeepSeek 会话日志上传默认关闭。开启 Web 开关或在 patch 中明确设置 `enabled: true` 可选择启用。明确传入的 `--patch` overlay 保持原样，仅影响本次启动。

升级后首次启动时，启动器会把当前 profile 的 `cordis.patch.yml` 中已保存的 `enabled: true` 重置为 `false`。它还会从 `$DSH_HOME/cordis.patch.yml` 移除 `enabled: true`，避免 home 层覆盖之后的 profile 开启设置；并在 Settings 导入旧值之前，将 `$DSH_HOME/settings.yaml` 中旧格式的 `session-log-deepseek.enabled: true` 改为 `false`。其他 patch 字段保持不变。OTel 反馈上传使用独立设置，不受影响。

## 迁移

1. 对保存过上传设置的每个 profile 启动一次。共享 home 和旧版设置在首次启动任一 profile 时迁移；各 profile 自己保存的选项会在该 profile 首次启动时迁移。
2. 要使用 Web 开关，请先移除 home 中 `session-log-deepseek` 条目剩余的 `config`；home config 会替换 profile config。然后在 Web 中开启**设置 → 通用 → 在使用官方模型 API 时上传 Session Log**。也可以在 home 或 profile 的 `cordis.patch.yml` 中设置 `enabled: true`，或通过 `--patch` overlay 仅为一次启动选择开启，且不会改写已保存文件。
3. 确认 Web 开关已开启，或预期的 patch 层含有 `enabled: true`，然后重启该 profile。迁移完成后，该选项会继续保持开启。
