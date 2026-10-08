---
kind: upgrade-guide
description: "贡献者工具链改用 Vite Plus，VitePress 文档站点已移除。"
---

# Vite Plus 与文档源变更

[English](guide.md) | 中文

## 变更

仓库的 build、test、lint 和格式化工作流现使用 Vite Plus 1.1。VitePress 文档站点、`docs:*` 与 `website:*` 命令，以及仓库的手动 GitHub Pages 部署工作流均已移除。`docs/` 下的 Markdown 仍是维护中的文档源；文档检查会验证这些文件，但不会生成替代站点。

## 迁移

1. 使用 Node.js `^22.19.0 || ^24.11.0 || >=26.0.0` 和仓库固定的 pnpm `11.7.0`。根 package 声明的引擎范围未变；Vite Plus 收窄了贡献者工具链范围。CI 测试 Node 22.19、24.11.1 和 26。
2. 在仓库根目录运行 `pnpm install --frozen-lockfile`，安装锁定的工具链和依赖。
3. 运行 `pnpm run build`、`pnpm run test` 和 `pnpm run lint` 执行常规贡献者工作流。使用 `pnpm run test:docs` 验证文档源；该命令不会构建网站。确认每条命令均成功完成后再使用此检出目录。
4. 阅读并编辑 `docs/` 下的 Markdown 源文件，从[开发指南](../../../development.zh.md)开始。原有 VitePress 和 website 脚本已不可用。
