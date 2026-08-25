# manage-marketplace

Reference skill for managing Claude Code plugins and marketplaces — installing, updating, removing plugins, and adding/removing/listing marketplaces. It is a command-reference prompt that Claude consults to answer the user's question or run the right CLI invocation.

## Triggers

Loaded when the user asks about:
- Installing or removing a plugin
- Adding, updating, or removing a marketplace
- Managing their Claude Code plugin setup
- Auto-update behavior, private-repo auth, marketplace listing

## What it contains

The `SKILL.md` is a reference document of `claude plugin` CLI commands and the `/plugin` interactive flow. Topics covered: marketplace add/remove/update, plugin install/remove/update, browsing, JSON output, GitHub shorthand, local paths, direct URLs, and auth tokens for private marketplaces.

## Related

- `create-marketplace` — scaffolds a new marketplace that this skill then helps publish/install
- `create-plugin` — scaffolds a plugin inside a marketplace
- `super-help` — broader Q&A across the whole Claude Code ecosystem
