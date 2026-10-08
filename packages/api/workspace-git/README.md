---
description: "Shows the selected Session's current Git branch or detached revision without exposing its local path or remote URL."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-git

English | [中文](README.zh.md)

## Summary

Show the selected Session's Git branch without exposing its local path or remote URL. The service reads the Session working directory through its configured subprocess provider and returns a sanitized repository label with a branch or detached revision. Set the Host deadline and Client refresh delay for the deployment.

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

Mount the Host plugin beside the Session, subprocess, sandbox policy, and Typert services, then mount `dsh-api-remotes` on the Client to expose its generated Remote.

### When to choose it

Use this package when a Web or Desktop Client needs the current branch for its selected Session. The service uses the Session's authoritative working directory and reports only a GitHub owner/repository pair or the checkout directory name; it does not reveal origin URLs or local paths.

### Minimal configuration

The Web profile mounts this service in its Host composition. A Host composition with the required services can mount it as follows:

```yaml
- id: workspace-git
  name: '@deepseek-ai/dsh-api-workspace-git'
  config:
    deadlineMs: 2000
    refreshMs: 5000
```

| Field | Default | Meaning |
|---|---:|---|
| `deadlineMs` | `2000` | Bound Session lookup and Git subprocess time. |
| `refreshMs` | `5000` | Tell the Client when to refresh a successful status. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-api-workspace-git) lists every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The Host performs bounded Git reads in the subprocess provider's execution world and returns only display metadata to the Client.

<details>
<summary>Implementation internals — click to expand</summary>

A status request resolves a live Session header or reads a cold Session header from persistence. It uses that header's `cwd`, falling back to the configured workspace root only when the header has no directory. It runs Git through `ctx.subprocess`, removes inherited Git repository selectors and indexed command-line configuration, bounds output and execution time, and sanitizes GitHub remotes before returning a result. The Remote cancellation signal reaches the Session lookup and every spawned process.

| Source | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | Host service, bounded subprocess reads, and GitHub-origin sanitization. |
| [src/types.ts](src/types.ts) | Client-safe branch, detached revision, and no-checkout values. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-api-remotes](../remotes/README.md) — mounts the generated Remote on the Client.
- [dsh-api-session-controller](../session-controller/README.md) — owns the Session identity and working-directory record.
- [dsh-subprocess](../../subprocess/subprocess/README.md) — defines execution-world process requests and cancellation.

-----

<a id="model-experience"></a>
## Model Experience

None, as branch metadata is browser chrome and never enters model requests or Session events.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

Git metadata covers the current branch or detached revision and a display-only repository label.

<a id="known-limitations-and-deferred-work"></a>

- **No checkout produces no label** — a missing Git executable, non-repository directory, or repository without a commit returns `none`; the Client leaves its composer unchanged.
- **Only GitHub remotes provide owner and repository names** — other hosts and local remotes use the Git root directory name, so this service does not identify their hosting project.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
