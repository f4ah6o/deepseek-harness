---
description: "在 Web 和 Desktop composer dock 中显示所选 Session 的 Git 分支或分离 HEAD 版本号。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git-branch

[English](README.md) | 中文

## 概述

在 composer 的回合和 Token 状态旁显示所选 Session 的 Git 分支。GitHub checkout 会显示经过清理的 owner/repository 名称；其他 remote 则显示仓库目录名。Session 没有 Git checkout 时隐藏此标签。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

将此 Client 插件与 `dsh-api-workspace-git` 和 `dsh-api-remotes` 一起加载；它会在 composer dock 左侧添加 Git 标签且无需配置。

### 何时选择此包

当用户需要在 Web 或 Desktop Session 中随时查看当前分支时，使用此包。它会读取经过清理的 `workspaceGit` Remote，在成功读取后的间隔、窗口获得焦点或页面可见性改变时刷新；Host 报告无 checkout 时隐藏标签。

### 最小配置

在已加载 `dsh-api-remotes` 且包含对应 Host 服务的 Client composition 中添加此插件：

```yaml
- id: ui-git-branch
  name: '@deepseek-ai/dsh-client-ui-git-branch'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| — | — | 此插件无需配置。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-client-ui-git-branch)列出所有可接受字段。

-----

<a id="understand-the-implementation"></a>
## 了解实现

此标签会读取 Host 为当前 Session 提供的分支元数据，并确保 Git 信息不会进入提示词或 Session 事件。

<details>
<summary>实现细节 — 点击展开</summary>

Client 插件会注册 composer dock 位置，并向组件注入所选 Session 标识、locale 和 Remote 调用。Session 改变或组件卸载时，组件会取消请求并忽略过期响应；刷新间隔由 Host 返回。

| 源文件 | 职责 |
|---|---|
| [src/client/index.ts](src/client/index.ts) | 注册 locale 和 composer dock 内容。 |
| [src/client/GitBranchChip.tsx](src/client/GitBranchChip.tsx) | 管理每个 Session 的请求并渲染分支标签。 |
| [src/client/locales.ts](src/client/locales.ts) | 英语和中文标签。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-api-workspace-git](../../api/workspace-git/README.zh.md) — Host 分支查询和显示信息清理。
- [dsh-api-remotes](../../api/remotes/README.zh.md) — 浏览器的生成 Remote assembly。
- [Web client architecture](../../../docs/subsystems/web-client.zh.md) — Client 插件加载和 composer slots。

-----

<a id="model-experience"></a>
## 模型体验

无：分支标签属于浏览器界面，不会进入模型请求或 Session 事件。

#### KV Cache effect

无；此包既不组装也不发送提供方请求。

## 已知限制和延期工作

标签只显示 Host 为所选 Session 提供的状态。

<a id="known-limitations-and-deferred-work"></a>

- **无 checkout 时 composer 保持不变** — Host 返回 `none` 时，此标签不显示仓库名称或分支。
- **Remote 失败时保留上次状态** — 刷新失败不会清除标签；窗口获得焦点或页面可见性改变时会重新请求。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
