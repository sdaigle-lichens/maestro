# Backlog

## Gitignore mode

Not everyone who works on a project wants to use maestro. Could the maestro-install skill suggest at the start if the user wants to install it as commited or ignored in the project ? If the root .claude folder is already gitignored then the question could be skipped. At the start of the installtion, if .claude is not gitignored and the user wants maestro to be ignored, then the installer could update the .claudeignore accordingly.

## Skill Cleanup

- Clean skills
- Reduce claude.md and rules files
- Reduce content of maestro, maestro-manager and to-maestro-tasks skills

## Fix agent models

- Haiku:tests and scribe. Make a meeting to explore the idea. Also have backend and frontend agent use a new haiku subagent called implementor ?

## Maestro task and manager flow

/maestro use the documentation workflow for this task. I would like the to-maestro-tasks skill to suggest at the end to the user to keep the session open and call maestro-manager when an epic is created is created. It could also suggest the user to open a new claude session for the different maestro tasks of the epic that can be done right now in parallel. This flow of to-maetro-tasks -> maestro-manager -> maestro sessions can also be added to the root README.md as the suggested flow when using worflow !

## Other

Move all concept skills to scribe but explore ?
Move concepts skills structure to code graph.

## Design

https://github.com/pbakaus/impeccable
