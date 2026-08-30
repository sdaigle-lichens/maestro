// Bundle entry for plugins/maestro/scripts/lib/maestro-concept-skills.cjs.
//
// The three concept-skill flows (`/create-concept-skills`, `/update-concept-skills`,
// `/update-single-concept-skill`) all need the same four boring, exactly-wrong-if-improvised
// operations: find every concept skill in a monorepo, do `major.minor` arithmetic, rewrite three
// frontmatter lines without disturbing the rest of the file, and stamp `maestro.json`.
//
// Every one of those is cheaper and more reliable as code than as prose in a SKILL.md. A model
// asked to "bump the minor version" in a prompt gets it right most of the time, and the times it
// doesn't are invisible — a version silently stuck at 1.0 makes `/update-single-concept-skill`
// research a skill that was already researched. So the skills call this bundle instead, and spend
// their tokens on the part that actually needs judgement.
//
// `concept-skills.ts` uses `fs` but nothing else — no env, no spawn — which is what makes it
// bundleable for a script running under bare `node` in a project with no node_modules.

export {
  TYPE_KEY,
  CONCEPT_TYPE,
  VERSION_KEY,
  LAST_UPDATE_KEY,
  INITIAL_VERSION,
  SUB_CONCEPTS_DIR,
  AGENT_NOTES_DIR,
  parseVersion,
  formatVersion,
  bumpMinor,
  bumpMajor,
  discoverConceptSkills,
  findConceptSkill,
  resolveSkillPath,
  stampConceptSkill,
  readConceptSkillsState,
  readAgentsAvailable,
  writeConceptSkillsState,
} from "../concept-skills.js";
export type { ConceptSkill } from "../concept-skills.js";
