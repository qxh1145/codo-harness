---
description: "Mounts the configured language servers installed on this machine, and the lsp tool when any is."
kind: "package-reference"
---

# @deepseek-ai/dsh-lsp-auto

## Summary

Takes the same `servers` config as `dsh-lsp-stdio`, keeps the servers whose command is installed, and mounts the provider and `dsh-tool-lsp` for them. A missing server is logged and skipped. With none installed, the model receives no `lsp` tool.

## Model Experience

Indirectly, through `dsh-tool-lsp`: one `lsp` tool and one prompt section, present only when a server is installed.

## Known Limitations and Deferred Work

- Installed servers are read once at load, so a newly installed server needs a restart.
- Each language server is a long-running process per workspace.
- `jdtls` 1.63 needs JDK 25 or newer, although its launcher accepts 21. On an older JDK every Java query reports that the server exited.
- `jdtls` names its data folder after the workspace folder's name, so two open workspaces with the same folder name share it.
- The first TypeScript query on a cold project can stop at the import instead of following it to the declaration.
