---
kind: upgrade-guide
description: "未保存语言偏好时，Web 和 Desktop 界面现在默认使用日语。"
---

# 首次运行时默认使用日语

[English](guide.md) | 中文

## 变更

Web bundle 现在包含日语语言包。profile 未保存 `locale.preference` 时，Web 和 Desktop 无论浏览器或操作系统使用何种语言，都会默认以日语打开。已明确保存的 `en`、`zh` 或 `ja` 偏好仍然生效。

## 迁移

无需迁移 profile。若 profile 尚未明确保存语言偏好而用户希望使用英文或中文，请打开「设置」→「通用」→「语言」并选择相应语言；该选择会保存到此 profile，并在后续启动时继续使用。
