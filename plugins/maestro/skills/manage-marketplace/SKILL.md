---
name: manage-marketplace
description: "Reference for managing Claude Code plugins and marketplaces: install, update, remove plugins; add, update, remove marketplaces. Use when the user asks how to install a plugin, remove a marketplace, update plugins, or manage their Claude Code plugin setup."
---

# Manage Marketplace

Reference guide for Claude Code plugin and marketplace management. All commands work both in the terminal (`claude plugin ...`) and inside a Claude Code session (`/plugin ...`).

## Plugins

### Install

```bash
# Browse and pick interactively
claude plugin marketplace add owner/repo
# Then inside Claude Code: /plugin → Browse and install plugins

# Install directly from the terminal
claude plugin install <plugin>@<marketplace>

# Example
claude plugin install ci@lichens-ai-dev-tools
```

### List installed

```bash
claude plugin list
```

### Enable / Disable

```bash
claude plugin enable <plugin>
claude plugin disable <plugin>
```

Disabled plugins keep their files but are not loaded by Claude Code.

### Update

Always include the marketplace name — omitting it will fail with "plugin not found": `claude plugin update <plugin>@<marketplace>`.
A restart is required to apply the update.

### Remove

```bash
claude plugin uninstall <plugin>
```

### Clean up unused dependencies

```bash
claude plugin prune
```

---

## Marketplaces

A marketplace is a catalog of plugins identified by a `.claude-plugin/marketplace.json` at its root. Registering a marketplace does **not** install anything — it just makes its plugins discoverable.

### Add

```bash
# GitHub shorthand
claude plugin marketplace add owner/repo

# Any git URL
claude plugin marketplace add https://gitlab.com/team/plugins.git

# Local path
claude plugin marketplace add ./relative/path/to/marketplace

# Direct URL to marketplace.json
claude plugin marketplace add https://example.com/marketplace.json
```

### List registered

```bash
claude plugin marketplace list

# Machine-readable
claude plugin marketplace list --json
```

### Update

```bash
# Update all marketplaces
claude plugin marketplace update

# Update one
claude plugin marketplace update <name>
```

Re-pulls the catalog, picks up new plugins and version bumps. Runs automatically at startup for marketplaces reachable without interactive credentials.

### Remove

```bash
claude plugin marketplace remove <name>
```

> **Warning:** This also uninstalls every plugin installed from that marketplace. To refresh without losing plugins, use `update` instead of remove + re-add.

---

## Auto-register for a team

Declare marketplaces in `.claude/settings.json` so teammates are prompted to install them when they open the project:

```json
{
  "extraKnownMarketplaces": {
    "my-marketplace": {
      "source": { "source": "github", "repo": "your-org/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "my-plugin@my-marketplace": true
  }
}
```

---

## Validate before publishing

```bash
claude plugin validate .
```

Checks `marketplace.json`, every `plugin.json`, skill/agent/command frontmatter, and `hooks/hooks.json` for syntax and schema errors.
