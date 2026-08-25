# create-plugin

Scaffolds a new plugin inside a local marketplace: creates the directory, writes `plugin.json`, and registers the plugin in `marketplace.json`. No mode toggle (single creation path).

## How it works

1. In the **Maestro desktop app** (`apps/maestro`), the user picks **Create → Plugin** from the top bar and fills the form (name, description, keywords, marketplace).
2. On submit the route calls `scaffoldPlugin` in `apps/maestro/src/core`, which writes `plugin.json`, creates `skills/`, and registers the plugin in the marketplace manifest — all deterministic, no model involved.
3. A plugin manifest is complete as written, so the confirmation does **not** open by itself; **Finish with Claude** on the result card is what runs this prompt, for the README and any hooks.
4. Invoked directly in a session instead (`/create-plugin`), there is no form and nothing pre-scaffolded: gather the fields conversationally and do every step.

See `apps/maestro/.claude/skills/create-skills-architecture/` for the full architecture.

## Payload contract

```
{ name, description, keywords, marketplacePath }
```

`keywords` is a `string[]`, collected via `ChipInput` in the app form.

## Output

- `<marketplacePath>/plugins/<name>/.claude-plugin/plugin.json`
- `<marketplacePath>/plugins/<name>/skills/` (empty, populated later by `create-skill` / `create-subagent`)
- `<marketplacePath>/plugins/<name>/README.md`
- New entry appended to `<marketplacePath>/.claude-plugin/marketplace.json` `plugins` array

## Related

- `create-marketplace` — creates the marketplace this plugin gets filed into
- `create-skill` / `create-subagent` — populate the plugin with content
- `manage-marketplace` — publish/update once the plugin is ready
