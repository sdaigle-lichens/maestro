# Move cleanup-skill into the concept-skills plugin and make the team meeting's use of it optional

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

cleanup-skill ships in the maestro plugin, but its only hard caller is update-single-concept-skill in the opt-in concept-skills plugin, so a project with concept-skills and no maestro hits a skill that doesn't exist. Its own logic is also concept-skill aware: it tells explainer skills (metadata.type marker or a sub-concepts/ directory) from normal published skills. Maestro's only use is optional: the team meeting's skill.edit apply kind runs it 'if it grew'.

Move cleanup-skill into the concept-skills plugin unchanged in behaviour. Make the maestro team meeting's skill.edit step conditional: when cleanup-skill is available in the session, run it; when it isn't, do a short inline pass instead (drop repeated ideas and restated prose, keep every trap and invariant) rather than referencing a missing skill. Remove cleanup-skill from the maestro plugin's description and anywhere else the maestro plugin or this repo's docs list it as a maestro skill. Any reference that names it with a plugin qualifier must use the new one.

## Acceptance criteria

- [ ] cleanup-skill exists only under the concept-skills plugin, and update-single-concept-skill's reference to it resolves within that plugin
- [ ] The maestro plugin no longer ships or lists cleanup-skill; no maestro-plugin file references it unconditionally
- [ ] The team meeting's skill.edit instructions run cleanup-skill when it is available and describe an inline fallback when it is not
- [ ] concept-skills plugin version bumped minor (new skill); maestro plugin version bumped patch
- [ ] No stale reference to cleanup-skill as a maestro skill remains in plugins/, .claude/ docs or the Maestro app; pnpm verify passes
- [ ] The handoff notes that users with maestro but without concept-skills lose /cleanup-skill on update

## Blocked by

None — can start immediately
