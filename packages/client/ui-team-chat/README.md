---
description: "Sidebar entry and main panel that open team chat in the Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-team-chat

## Summary

Adds a **Team chat** entry to the Web client's sidebar. It shows the page served at `/team` in the main panel. Team chat keeps its own sign-in, so the owner uses a team account there.

## Model Experience

None. This package only presents the existing `/team` page.

## Known Limitations and Deferred Work

- The panel assumes the Web client is served at the origin root.
- Desktop does not load this plugin, because its pages have no `/team` route.
