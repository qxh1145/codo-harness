---
description: "Team accounts, project channels and a read-only @codo agent served at /team."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-chat

## Summary

Gives a small team individual accounts, project channels, threads and a read-only `@codo` agent at `/team`. Members sign in here and never receive the Host's owner Peer, so a member account grants chat and nothing else.

## Use this package

The Web bundle mounts this plugin. On first start it writes a one-time setup code to `<dataDir>/setup-code.txt`. Opening `/team` with that code creates the first admin, and admins add teammates through single-use invitation links.

| Field | Default | Meaning |
|---|---|---|
| `dataDir` | `<DSH_HOME>/team` | Accounts, channels and messages |
| `reposDir` | `<DSH_HOME>/repos` | Directory holding the repositories a channel may link |
| `maxAgentJobs` | `2` | `@codo` replies running at once; others wait in order |
| `agentTimeoutSeconds` | `300` | Longest one reply may run |

## Security model

- Passwords use scrypt. Session and invitation tokens are stored only as SHA-256 digests.
- The session cookie is `HttpOnly`, `SameSite=Strict` and scoped to `/team`. Writes must also come from the same origin.
- `@codo` keeps only `read`, `grep` and `glob`, enforced by `tools.restrict()`, and a tool guard confines them to the channel's repository.
- The guard refuses `.git`, env files, private keys and common credential files, resolving symlinks first.
- Chat text reaches the model as quoted untrusted data.

## Model Experience

Each `@codo` reply is one fresh Session on the default model. It sees the Standard preset's prompt and up to 30 thread messages, and the tool list holds only `read`, `grep` and `glob`. Sessions are not attached to a Workspace.

## Known Limitations and Deferred Work

- Messages are held in memory and appended to one file per channel, which suits a small team.
- `@codo` reads what is on disk, so repositories must be updated separately.
- Secret detection works by file name, so a secret in an ordinary source file stays readable.
- Tag to fix, channel summaries and cost tracking are not built yet.
