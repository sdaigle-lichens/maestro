# Concept Skills

I need to cleanup this project concepts/documentations skills. This is a recurring problem in many of my repositories so I want to create skills that will help my scribe agent generate and maintain relevant and up to date concepts/documentations skills. The skills will be: create-concept-skills, update-concept-skills and update-single-concept-skill.

A concept skill is a skill that explain a "core concept" of the project. A "core concept" is a concept that is deemed to be central in the project's implementation. It can be a large feature or an important logic/runtime section. Defining a core concept is not an exact science though. The criterias will depend from one user to another.

For example, in this project, core concepts could be:

- The log view page
- The workflow view page
- The agent view page
- The logic to update maestro
- The logic to install maestro
- The maestro skill runtime when using a workflow
- The logic shared by the create skills to create a skill, agent, plugin or marketplace

In comparison, a core concepts can have sub-concepts. For example the logic shared by the create skills to create a skill, agent, plugin or marketplace can have 4 sub-concepts for the specific creation of a skill, agent, plugin and marketplace.

## Concept Skill List

A concept skills list is simply a list of all the skills in a .claude that are core concepts skills. The concept skills can be identified because on creation, two metadata tags are added in the skill: `{type: concept-skill, last-update: commit-sha, version }`. To get the full list, there can be a script added in the marketplace that takes a directory path and goes through all .claude from the repository (in the case of monorepos) to find the concept skills. The `last-update` tells the update-single-concept-skill the last time the skill was updated so it can easily make a code diff since the last update to see if the code related to the skill was updated significantly. The `version` tells the concept skill's version so update-single-concept-skill knows if it is a first version created by the create-concept-skills that needs a more throughout search or if it is a version that has already been updated with more care.

Each of the concept skill can have a subdirectory called `sub-concepts`. In this directory are files referenced in the SKILL.md of the core concept that describe a sub-concept.

Similarly, each of the concept skill can have a subdirectory called `agents`. In there are files referenced in the SKILL.md of the core concept that give additional information about the core concepts that are useful for that agent in particular. It will only do so for agents used in the .claude/maestro.json. For example, it can give more details in the referenced files for the backend agent on how to implement certain things and in the test agent referenced file more details about how to test the concept. Still, the goal is not to do an exhaustive code search to find every details of the concept. The skill is there to GUIDE the agent through it's code exploration and to get the general context it needs about the concept quickly. Through it's work it can report to the scribe what is missing about the core concept's skill. This can be added in the report templates for each agent, so the main session knows that it needs to ask the scribe these updates.

To trace when the concept list was created and updated last, there will be a parameter called `concept-skills-last-update` in `.claude/maestro.json` that will take as a value the last commit SHA for when the `create-concept-skills` skill or `update-concept-skills` skill was run for the repository. There can also be a `concept-skills-version` parameter to help the update-concept-skills skill to know if the concept skills list as a whole is mature or not.

## Create Concept Skills

The goal of create-concept-skills, is to determine what are "core concepts" in the projects and to create their folder and file structure in the repository, including the sub-concepts. It can wait though for the `agents` directory since this will need to do more in depth exploration. The goal is mostly to create the file structure with a summary of each concept and sub-concepts in the related file. It does not need to do a throughout code search of the whole project. It simply needs to have enough knowledge about the overall app to be able to generate the core concepts list skeleton. It is not to become a know-it-all session that can understand the project it all it's details. I don't want it to burn a ton of tokens to create the list. It can use light agents like haiku to explore and report it's finding about the code and it's documentation so it has enough information to create a list of the overall project's concepts. In the update-single-concept-skill, the claude session will then go in more details about the concept's description and it's implementation.

The create-concept-skills will use the TaskCreate to go through the following steps:

1. Check if a concept skills list already exist by reading the `.claude/maestro.json`, if yes, prompt the user to use the update-concept-skills instead and stop there. If no, continue to the next step.
2. Find the README.md, CLAUDE.md, docs files and skills related to project documentation and skim through them to find the core concepts
3. Go through the code from an "eagle view" to try to find the core concepts empirically. This step is important because the doc found in step 1 may not be exhaustive nor up to date.
4. Propose to the user the core concepts for the projects and the sub-concepts attached to them
5. Go through a questionning session with the user to get to a fix version of the core concepts, sub-concepts and their mapping
6. Write the concept skills list skeleton by adding each of the concept skill directory in the appropriate `.claude/skills` directory, it's SKILL.md file and it's `sub-concepts` directory with a reference file for each concept.
7. Add to `.claude/maestro.json` the last commit SHA and bump the version.

## Update Concept Skills

This skill is similar to the create-concept-skills list but retrieves the existing concept skills list to see if it needs updating. If a report of the code changes is given to it, it could skip going through the code that was just updated in the Claude Session and just see from the code changes report and the current code maps to:

1. Validate that a concept skills list already exist by reading the `.claude/maestro.json`, if no, prompt the user to use the create-concept-skills instead and stop there. If yes, continue to the next step.
2. Read from `.claude/maestro.json` the last update commit sha.
3. If the last update commit predates the Claude Session starting commit, check the code diff. The skill can ask the main claude session for the commit to which it was on start.
4. Based on the report code change prompt and on the eventual code diff:
   1. Go through the documentation changes from the latest update commit SHA of the `last-update` parameter from `.claude/maestro.json` up to the session start commit SHA to evaluate first the README.md, CLAUDE.md, docs files and skills related to project documentation changes to try to find what core concepts were added and or updated empirically.
   2. Do the same with the code changes from an "eagle view" to try to find empirically what core concepts should be added and or updated
   3. Evaluate if new concepts skills need to be added
   4. Evaluate if concept skills need to be deleted
   5. Evaluate which concept skill needs update either in it's SKIIL.md, it's `sub-concepts` directory or in it's `agents` directory

5. If core concepts or sub-concepts need to be added or removed, validate them with the user first through a questioning session.
6. Update the concepts skills (directories/files) with the new the concept list structure and update in `.claude/maestro.json` the commit SHA to the last commit and bump the version. Do the same in each concept skill created/updated.

The goal of giving a code change report is to make the scribe agent use the update-concept-skills to go straight to the point (if the concept skill was up to date untill now) without having to waste resources to explore what the session changed in the code to understand who needs what in the concept skills. If a report of the code changes is not given, the steps are the same, but the skill also evaluate the current code changes from the current Claude session.

The update-concept-skill can also be launched when an agent is added or deleted to see if the `agents` folders of the concept skills need to be updated. It that case, the skill will focus on the changes related to the agent added or deleted.

## Concept Skill Version and Last Update Commit

The version and the last update commit can be determined from a script to save Claude Code ressources. A concept skill's version can be a minor bump on `update-concept-skills` since it does not do a throughout code search for this skill. In comparison, `update-single-concept-skill` can do a major version bump. For the version in `.claude/maestro.json` a major version change can happen when a core skill is added or deleted.

## Update Concept Skill

After the core concept list is created or updated, the scribe agent can use the update-single-concept-skill to improve a core concept skill on demand. Here, the agent can go into more details to understand how the core concepts works, add references files to it's sub concept and explain how it is related to the other core concepts. The update-single-concept-skill can work in the following way:

1. Check the skill's version to see if it was simply created or if it is more mature and already had some major updates/revisions
2. Skim through the code to get an overview of the core concept AND it's relation with the other core concepts
3. Update the SKILL.md file for the core concepts with more details
4. Update the referenced files in the children /subconcepts folder for the sub-concepts with more details
5. Write referenced files in the children /agents folder for agent specific notes (not mandatory, only if needed)

The update-single-concept-skill should try to keep each file lean when possible. We do not want the core concepts skills to bloat the context, only to give what is needed. It goes through a further search than the update-concept-skills skill does, but it is still not a know it all session about the core concept that burns a ton of token. Also remember that the core concept list is just to need the information needed for an agent to work with enough context and the lessons learned, We do not want to bloat the agent's context with unecessary informations.

## Filtering Between Concept Skills and Documentation

In short term, concepts skills are there to help Claude Code and it's subagents. Documentation is there for humans. To distinct what goes where, we can add a `/scribe` skill to the scribe agent that will be loaded automatically in the default workflow from `.claude/maestro.json`. The scribe skill is there to thell what goes where. For example, when the `@scribe` agent finds schemas/drawings in concepts skills, it can ask if the user wants to move them in a doc file instead since this is mostly there for human understanding.

For knowledge that is shared, the `/scribe` should decide to create a file in the `docs` directory that will be referenced by the concept skill. A good example is an instruction file, like the one to understand how to do a database migration. Both humans and agents need to know how to. The `/scribe` can wright and maintain a human friendly `docs/migration-instructions.md` file that can be referenced for the `backend-project.md` skill. Combined with the create-concept-skills, update-concept-skills and update-single-concept-skill, the scribe skill should enable the scribe agent to maintain quality documentation and concept skills for both human and agents.
