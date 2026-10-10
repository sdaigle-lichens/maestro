// Bundle entry for plugins/maestro/scripts/lib/maestro-team-meeting.cjs — the pure half of
// `/maestro-team-meeting` (brief, proposal schema, conflicts, tally), required by
// `plugins/maestro/scripts/maestro-team-meeting.cjs`. Pure, no `node:sqlite`. The meeting-mode
// flag itself (start/end, what the hooks read) is in the `maestro-session` bundle.

export {
  PROPOSAL_KINDS,
  AUTO_KINDS,
  parseProposalFile,
  currentPositions,
  findConflicts,
  tierOf,
  tally,
  renderDecision,
  applyAutoTier,
  ownerOf,
  planOwnerRuns,
  placedAgents,
  buildCommonBrief,
  buildAgentBrief,
  type Proposal,
  type ProposalFile,
  type ProposalTier,
  type Conflict,
  type TallyRow,
  type TallyContext,
  type AgentTier,
  type BriefAgent,
  type BriefRule,
  type BriefInput,
  type DecisionRecord,
  type PlacementResult,
  type OwnerPlan,
} from "../team-meeting.js";
