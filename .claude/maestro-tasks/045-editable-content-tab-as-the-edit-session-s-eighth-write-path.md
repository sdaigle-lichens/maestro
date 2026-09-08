# Editable Content tab as the edit session's eighth write path

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Make the Content tab's body editable, via a textarea, when and only when the selected agent is project-tier — the same editability gate already used for the description field. Non-project-tier agents keep the Content tab read-only in edit mode, with an explanatory note analogous to the description field's; the existing "Copy into the project" fork button is the escape hatch (forking already copies the full file, body included, so a freshly forked agent's Content tab becomes editable with no further changes needed there). Wire the Content tab into the Agents view's single edit session: entering edit mode includes the body in the draft, Cancel discards it like every other field, and Save writes it back as an additional write path alongside the existing seven (report, handoffs, avatar, type, project tag, description, skills) — attempted only when changed, with its own named failure if the write fails, and without blocking or discarding the other writes' results. The write must preserve the agent's YAML frontmatter block byte-for-byte and replace only the body beneath it — the inverse of how the existing description write preserves the body and rewrites inside the frontmatter block.

## Acceptance criteria

- [ ] Pressing Edit on a project-tier agent makes the Content tab's body editable via a textarea; Cancel discards any changes to it exactly like every other draft field.
- [ ] Saving a changed body writes it to the agent's .md file, leaving the frontmatter block (everything between and including the two `---` delimiters) byte-for-byte unchanged.
- [ ] Saving when the body is unchanged does not rewrite the file.
- [ ] On a non-project-tier agent, the Content tab remains read-only in edit mode with an explanatory note, and forking the agent into the project (existing Copy-into-project button) makes its Content tab editable afterward with no further action.
- [ ] A failed content write surfaces as its own named failure (e.g. "content: <error>") and keeps the editor open, without discarding or blocking the other write paths' results.
- [ ] A core-level test proves the frontmatter-preserving rewrite: given a source file, replacing the body reproduces the original frontmatter block byte-for-byte while only the body text changes.

## Blocked by

- `044-read-only-content-tab-for-agent-markdown-body.md`
