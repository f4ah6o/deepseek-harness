---
description: "Shows the selected Session's Git branch or detached revision in the Web and Desktop composer dock."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-git-branch

English | [中文](README.zh.md)

## Summary

Show the selected Session's Git branch beside the composer turn and token status. The chip displays a sanitized owner/repository label for GitHub checkouts and a repository directory name for other remotes. It stays hidden when the Session has no Git checkout.

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

Mount this Client plugin with `dsh-api-workspace-git` and `dsh-api-remotes`; it adds the Git chip at the left side of the composer dock and takes no configuration.

### When to choose it

Use this package when users need the active branch while they work in a Web or Desktop Session. It reads the sanitized `workspaceGit` Remote, refreshes after a successful interval and on focus or visibility changes, and hides the chip when the Host reports no checkout.

### Minimal configuration

Add the plugin to a Client composition that already mounts `dsh-api-remotes` and includes the matching Host service:

```yaml
- id: ui-git-branch
  name: '@deepseek-ai/dsh-client-ui-git-branch'
```

| Field | Default | Meaning |
|---|---|---|
| — | — | This plugin takes no configuration. |

The generated [configuration catalog](../../../docs/config-catalog.md) lists the plugin among the entries without configuration.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The chip reads Host-owned branch metadata for the mounted Session and keeps Git details out of prompts and Session events.

<details>
<summary>Implementation internals — click to expand</summary>

The Client plugin registers the composer dock seat and injects the selected Session identity, locale, and Remote call into its component. The component cancels a request when the Session changes or it unmounts, ignores stale responses, and follows the refresh interval returned by the Host.

| Source | Responsibility |
|---|---|
| [src/client/index.ts](src/client/index.ts) | Locale registration and composer dock contribution. |
| [src/client/GitBranchChip.tsx](src/client/GitBranchChip.tsx) | Per-Session request lifecycle and branch-chip rendering. |
| [src/client/locales.ts](src/client/locales.ts) | English and Chinese labels. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-api-workspace-git](../../api/workspace-git/README.md) — Host branch lookup and display-value sanitization.
- [dsh-api-remotes](../../api/remotes/README.md) — generated Remote assembly for the browser.
- [Web client architecture](../../../docs/subsystems/web-client.md) — Client plugin loading and composer slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the branch chip is browser chrome and never enters model requests or Session events.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

The chip displays only the Host status available for the selected Session.

<a id="known-limitations-and-deferred-work"></a>

- **No checkout leaves the composer unchanged** — the chip does not show a repository name or branch when the Host returns `none`.
- **Remote failures retain the last displayed status** — a failed refresh does not clear the chip; focus or a visibility change retries the request.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
