---
description: "显示所选 Session 的当前 Git 分支或分离 HEAD 版本号，不公开本地路径或远程 URL。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-git

[English](README.md) | 中文

## 概述

显示所选 Session 的 Git 分支，不公开本地路径或远程 URL。服务会通过配置的子进程提供方读取 Session 工作目录，并返回经过清理的仓库名称以及分支或分离 HEAD 版本号。可为部署设置 Host 截止时间和 Client 刷新间隔。

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

在 Host composition 中将此插件与 Session、子进程、sandbox policy 和 Typert 服务一起加载，然后在 Client 上加载 `dsh-api-remotes` 以启用生成的 Remote。

### 何时选择此包

当 Web 或 Desktop Client 需要所选 Session 的当前分支时，使用此包。服务使用 Session 的权威工作目录，只返回 GitHub owner/repository 名称或 checkout 目录名；不会公开 origin URL 或本地路径。

### 最小配置

Web profile 会在 Host composition 中加载此服务。具有所需服务的 Host composition 可以按以下方式加载：

```yaml
- id: workspace-git
  name: '@deepseek-ai/dsh-api-workspace-git'
  config:
    deadlineMs: 2000
    refreshMs: 5000
```

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `deadlineMs` | `2000` | 限制 Session 查找和 Git 子进程的运行时间。 |
| `refreshMs` | `5000` | 告知 Client 何时刷新成功读取的状态。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-api-workspace-git)列出所有可接受字段。

-----

<a id="understand-the-implementation"></a>
## 了解实现

Host 会在子进程提供方的执行环境中执行有界 Git 查询，并仅向 Client 返回显示所需的元数据。

<details>
<summary>实现细节 — 点击展开</summary>

状态请求会解析在线 Session header，或从持久化存储读取离线 Session header。服务使用 header 中的 `cwd`；只有 header 未提供目录时才回退到已配置的 workspace root。Git 命令通过 `ctx.subprocess` 运行，会移除继承的 Git 仓库选择变量和索引命令行配置，限制输出和运行时间，并会在返回前清理 GitHub remote。Remote 取消信号会传递给 Session 查询和每个已启动的进程。

| 源文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | Host 服务、有界子进程查询和 GitHub origin 清理。 |
| [src/types.ts](src/types.ts) | Client 可用的分支、分离 HEAD 版本号和无 checkout 值。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-api-remotes](../remotes/README.zh.md) — 在 Client 上挂载生成的 Remote。
- [dsh-api-session-controller](../session-controller/README.zh.md) — 管理 Session 标识和工作目录记录。
- [dsh-subprocess](../../subprocess/subprocess/README.zh.md) — 定义执行环境中的子进程请求和取消。

-----

<a id="model-experience"></a>
## 模型体验

无：分支元数据属于浏览器界面，不会进入模型请求或 Session 事件。

#### KV Cache effect

无；此包既不组装也不发送提供方请求。

## 已知限制和延期工作

Git 元数据只涵盖当前分支或分离 HEAD 版本号，以及仅用于显示的仓库名称。

<a id="known-limitations-and-deferred-work"></a>

- **无 checkout 时不显示标签** — 缺少 Git 可执行文件、目录不是仓库或仓库尚无提交时返回 `none`；Client 不会更改 composer。
- **只有 GitHub remote 会提供 owner 和 repository 名称** — 其他托管服务和本地 remote 会使用 Git 根目录名称，因此此服务不会标识其托管项目。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
