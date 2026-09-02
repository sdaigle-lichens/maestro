# The Maestro marketplace

This repository is a **Claude Code plugin marketplace** — a catalog identified by
[`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) at its root. It currently
publishes one plugin, `maestro`, whose source lives at
[`plugins/maestro/`](../plugins/maestro).

Registering a marketplace does **not** install anything; it makes its plugins discoverable.

## Installing

```bash
claude plugin marketplace add sdaigle-lichens/maestro
claude plugin install maestro@maestro
```

Then run `/maestro-install` inside the project you want Maestro to orchestrate.

The first argument to `install` is `<plugin>@<marketplace>`. Both are named `maestro` here — the
plugin and the catalog that publishes it — which reads oddly but is correct.

## Updating

```bash
claude plugin marketplace update maestro   # re-pull the catalog
claude plugin update maestro@maestro       # update the installed plugin
```

Two things worth knowing:

- **Always include the marketplace name when updating a plugin.** `claude plugin update maestro`
  fails with "plugin not found".
- **A restart is required** before an update takes effect.

`claude plugin marketplace update` runs automatically at startup for marketplaces reachable without
interactive credentials, so the catalog usually refreshes on its own; the plugin itself does not.

### Why an update may appear to do nothing

Claude Code caches the plugin **per version**, and `autoUpdate` only re-pulls when the `version`
field in [`plugins/maestro/.claude-plugin/plugin.json`](../plugins/maestro/.claude-plugin/plugin.json)
changes. A change shipped to `hooks/` or `scripts/` **without a version bump is invisible** to
everyone who already has the plugin installed.

This is the most common cause of "my hook fix isn't running". There is a second, separate cause —
hooks a project installed *locally* run from copies under `<project>/.claude/scripts/` and are stale
until someone re-installs. The two paths and their different failure modes are documented for agents
in `.claude/skills/updating-maestro/`.

## Listing, disabling and removing

```bash
claude plugin list                      # what's installed
claude plugin marketplace list [--json] # what catalogs are registered

claude plugin disable maestro           # keep the files, stop loading it
claude plugin enable maestro

claude plugin uninstall maestro
claude plugin prune                     # drop unused dependencies
```

```bash
claude plugin marketplace remove maestro
```

> **Warning:** removing a marketplace also uninstalls every plugin installed from it. To refresh
> without losing plugins, use `marketplace update` rather than remove-and-re-add.

## Installing from a local checkout

Useful while developing this repo — point the marketplace at the working tree instead of GitHub:

```bash
claude plugin marketplace add /path/to/maestro
claude plugin install maestro@maestro
```

Validate before publishing:

```bash
claude plugin validate .
```

That checks `marketplace.json`, every `plugin.json`, skill/agent/command frontmatter, and
`hooks/hooks.json` for syntax and schema errors.

## Auto-registering for a team

Declare the marketplace in a project's `.claude/settings.json` so teammates are prompted to install
it when they open the project:

```json
{
  "extraKnownMarketplaces": {
    "maestro": {
      "source": { "source": "github", "repo": "sdaigle-lichens/maestro" }
    }
  },
  "enabledPlugins": {
    "maestro@maestro": true
  }
}
```

## Publishing a change

1. Make the change under `plugins/maestro/`.
2. If it touches `scripts/lib/*.cjs`, regenerate rather than editing by hand —
   `pnpm --filter maestro build:plugin-libs` (see
   `apps/maestro/.claude/skills/plugin-libs-parity/`).
3. **Bump `version` in `plugins/maestro/.claude-plugin/plugin.json`.** Without this, installed copies
   never pick the change up.
4. `claude plugin validate .`
5. Commit and push. The catalog is the repo, so a push publishes it.

---

For managing plugins and marketplaces in general — not just this one — the `maestro` plugin ships a
`/manage-marketplace` reference skill.
