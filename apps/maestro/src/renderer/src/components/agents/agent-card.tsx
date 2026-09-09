// /agents centre pane — the agent card and the Edit / Cancel / Save footer beneath it.
//
// The card's `min-height` is load-bearing, not decoration: view and edit render the same box so
// pressing Edit swaps the controls without the page reflowing under the pointer. The details
// column below the avatar is `justify-between` for the other half of that — when the card is
// taller than its content (which view mode always is, having no category row and no arrows) the
// three groups spread instead of bunching at the top.

import { Copy, Pencil } from "lucide-react";
import {
  AGENT_TYPES,
  GLOBAL_TAG,
  type AgentType,
  type AvatarCategory,
  type AvatarLayers,
} from "../../../../shared/ipc";
import AgentAvatarBlock from "./agent-avatar-block";
import {
  CARD_MIN_HEIGHT,
  DASHED_ADD,
  FIELD_CONTROL,
  FOOTER_BUTTON,
  PRIMARY_CHIP,
  type AgentSkill,
} from "./agent-shared";

/** A chip is "active" when it is in either of the instance's two lists — see `AgentSkill`. */
function activeCount(skills: AgentSkill[]): number {
  return skills.filter((s) => s.mode !== null).length;
}

function SkillChip({
  skill,
  editing,
  onToggle,
  onCycleMode,
}: {
  skill: AgentSkill;
  editing: boolean;
  onToggle: () => void;
  onCycleMode: () => void;
}) {
  const active = skill.mode !== null;
  return (
    <span
      onClick={editing ? onToggle : undefined}
      title={
        active
          ? skill.mode === "loaded"
            ? "Loaded — the SubagentStart hook loads this before the agent works"
            : "Referenced — surfaced as available; the agent loads it only if the task needs it"
          : "Not attached — unticked, and dropped from this instance when you save"
      }
      className={`relative inline-flex items-center gap-[7px] font-mono text-[11.5px] border border-(--line-2) rounded-md px-[9px] py-1 text-(--ink-2) ${
        editing ? "cursor-pointer" : "cursor-default"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -inset-px rounded-md border border-(--primary-dim-2) bg-(--primary-dim) pointer-events-none"
        />
      )}
      {editing && (
        <span className="relative w-3 h-3 grid place-items-center border border-(--line-2) rounded-[3px] text-[9px] text-(--primary)">
          {active ? "✓" : ""}
        </span>
      )}
      <span className={`relative ${active ? "text-(--ink-2)" : "text-(--ink-3)"}`}>{skill.id}</span>
      {/*
        The one control the design didn't draw. A Maestro instance keeps its skills in TWO lists —
        `loaded_skills`, which the SubagentStart hook injects before the agent starts, and
        `referenced_skills`, which are only offered — and a chip that showed neither would let a
        save silently demote every loaded skill to referenced. stopPropagation so switching the
        mode doesn't also untick the chip it sits inside.
      */}
      {active && (
        <button
          type="button"
          disabled={!editing}
          onClick={(e) => {
            e.stopPropagation();
            onCycleMode();
          }}
          title={editing ? "Switch between loaded and referenced" : undefined}
          className={`relative font-mono text-[9px] uppercase tracking-[0.08em] px-1 rounded-[3px] border ${
            skill.mode === "loaded" ? "border-(--primary-dim-2) text-(--primary)" : "border-(--line-2) text-(--ink-3)"
          } ${editing ? "cursor-pointer hover:border-(--primary) hover:text-(--primary)" : "cursor-default"}`}
        >
          {skill.mode === "loaded" ? "loaded" : "ref"}
        </button>
      )}
    </span>
  );
}

export default function AgentCard({
  name,
  source,
  description,
  type,
  projectTag,
  projectTagOptions,
  layers,
  skills,
  editing,
  saving,
  forking,
  activeCat,
  descriptionEditable,
  skillsEditable,
  footerNote,
  nextSkill,
  onActiveCat,
  onDescription,
  onType,
  onProjectTag,
  onLayers,
  onToggleSkill,
  onCycleSkillMode,
  onAddSkill,
  onStartEdit,
  onCancel,
  onSave,
  onFork,
}: {
  name: string;
  /** The tier this agent resolved from — "project", "user", "maestro", or a plugin name. */
  source: string;
  description: string;
  type: AgentType;
  projectTag: string;
  projectTagOptions: string[];
  layers: AvatarLayers;
  skills: AgentSkill[];
  editing: boolean;
  saving: boolean;
  /** A fork is in flight — disables the fork control the same way `saving` disables Save. */
  forking: boolean;
  activeCat: AvatarCategory;
  descriptionEditable: boolean;
  skillsEditable: boolean;
  /**
   * The one line of edit-mode explanation, rendered in the FOOTER rather than in the card. Inside
   * the card it would change the card's height with its own wrapping, and the card's height is
   * what stops the page reflowing when the user presses Edit.
   */
  footerNote: string | null;
  /** The next catalog skill the `+` would attach, or null when the catalog is exhausted/empty. */
  nextSkill: string | null;
  onActiveCat: (cat: AvatarCategory) => void;
  onDescription: (value: string) => void;
  onType: (value: AgentType) => void;
  onProjectTag: (value: string) => void;
  onLayers: (layers: AvatarLayers) => void;
  onToggleSkill: (index: number) => void;
  onCycleSkillMode: (index: number) => void;
  onAddSkill: () => void;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  /** "Copy into the project" — the read-only card's escape hatch. Always shadows under the same name. */
  onFork: (newName: string) => void;
}) {
  const isProjectTier = source === "project";

  return (
    <div className="max-w-[500px] mx-auto px-7 pt-7 pb-14">
      <section
        className="flex flex-col rounded-[14px] border border-(--line) p-[22px] shadow-(--shadow-2)"
        style={{
          minHeight: CARD_MIN_HEIGHT,
          background: "linear-gradient(180deg, var(--bg-elev), var(--bg-2))",
        }}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-(--line)">
          <div className="flex items-baseline gap-2.5 min-w-0 flex-wrap">
            <h1 className="m-0 text-[22px] font-semibold tracking-[-0.02em] text-(--ink)">{name}</h1>
            {/* Consistent with which of the left pane's two sections this agent is listed under. */}
            <span
              title={isProjectTier ? "Lives in this project's .claude/agents/" : `Resolved from the ${source} tier`}
              className="flex-none font-mono text-[10px] uppercase tracking-[0.08em] border border-(--line-2) rounded pl-[9px] pr-[7px] pt-[2px] pb-[3px] text-(--ink-3)"
            >
              {isProjectTier ? "Project" : "Global"}
            </span>
          </div>
          {editing ? (
            <select
              value={type}
              onChange={(e) => onType(e.target.value as AgentType)}
              className={`flex-none cursor-pointer ${FIELD_CONTROL}`}
            >
              {AGENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <span className={`${PRIMARY_CHIP} flex-none text-[11px] uppercase tracking-[0.06em] px-2.5 pt-1 pb-[5px]`}>
              {type}
            </span>
          )}
        </div>

        <div className="flex-1 flex flex-col gap-4 pt-4">
          <AgentAvatarBlock
            layers={layers}
            editing={editing}
            activeCat={activeCat}
            onActiveCat={onActiveCat}
            onChange={onLayers}
          />

          <div className="w-full min-w-0 flex-1 flex flex-col justify-between gap-4 border-t border-(--line) pt-4">
            <div>
              <div className="flex items-center gap-2 mb-[9px]">
                <span className="section-label">Description</span>
              </div>
              {editing && descriptionEditable ? (
                <textarea
                  value={description}
                  onChange={(e) => onDescription(e.target.value)}
                  rows={3}
                  className="w-full resize-none overflow-y-auto px-[11px] py-[9px] rounded-lg bg-(--bg-2) border border-(--line-2) text-(--ink) text-[12.5px] leading-[1.55] outline-none focus:border-(--primary) focus:bg-(--bg-3)"
                />
              ) : (
                <p className="m-0 text-[13px] leading-[1.6] text-(--ink-2) text-pretty">{description}</p>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-[9px]">
                <span className="section-label">Skills</span>
                <span className="font-mono text-[9.5px] text-(--ink-3)">
                  {activeCount(skills)} of {skills.length} active
                </span>
              </div>
              <div className="flex flex-wrap gap-[7px]">
                {skills.map((skill, i) => (
                  <SkillChip
                    key={skill.id}
                    skill={skill}
                    editing={editing && skillsEditable}
                    onToggle={() => onToggleSkill(i)}
                    onCycleMode={() => onCycleSkillMode(i)}
                  />
                ))}
                {editing && skillsEditable && (
                  <button
                    type="button"
                    onClick={onAddSkill}
                    disabled={nextSkill === null}
                    title={
                      nextSkill
                        ? `Attach ${nextSkill}`
                        : "Every skill this project makes available is already attached."
                    }
                    className={DASHED_ADD}
                  >
                    +
                  </button>
                )}
                {skills.length === 0 && !editing && (
                  <span className="text-[12px] text-(--ink-3)">No skills attached.</span>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-[9px]">
                <span className="section-label">Project tag</span>
              </div>
              <div className="flex flex-wrap gap-[7px]">
                {editing ? (
                  // A single dropdown, not the design's chips-plus-`+`: an agent has exactly ONE
                  // project tag (`agent-project-tags.ts` is keyed by agent name), so there is
                  // never a second one to add — only a different one to pick.
                  <select
                    value={projectTag}
                    onChange={(e) => onProjectTag(e.target.value)}
                    className={`cursor-pointer font-mono text-[11px] ${FIELD_CONTROL}`}
                  >
                    {projectTagOptions.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    title={
                      projectTag === GLOBAL_TAG
                        ? "Matches a skill tagged for any project"
                        : `Matches skills tagged ${projectTag}`
                    }
                    className="inline-flex items-center font-mono text-[11px] border border-(--line-2) bg-(--bg-3) rounded-md px-2 py-[3px] text-(--ink-2)"
                  >
                    {projectTag}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {editing ? (
        <div className="flex items-center justify-end gap-2.5 mt-[18px]">
          <span className="flex-1 text-[11.5px] leading-[1.4] text-(--ink-3)">{footerNote}</span>
          <button type="button" onClick={onCancel} disabled={saving} className={FOOTER_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="h-[34px] px-[18px] rounded-md border border-(--primary) bg-(--primary) text-[#1c1917] text-[12.5px] font-medium cursor-pointer transition-colors duration-[120ms] hover:bg-(--primary-2) hover:border-(--primary-2) disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2.5 mt-[18px]">
          {isProjectTier ? (
            <span />
          ) : (
            // "Copy into the project" sits exactly where the read-only description just told the
            // user they'd hit a wall — a next step, not just a refusal. Always shadows the original
            // under the same name.
            <button
              type="button"
              onClick={() => onFork(name)}
              disabled={forking}
              title={forking ? "Copying…" : "Copy into the project"}
              data-testid="agent-fork-button"
              className={FOOTER_BUTTON}
            >
              <Copy size={13} />
            </button>
          )}
          <button type="button" onClick={onStartEdit} title="Edit agent" className={FOOTER_BUTTON}>
            <Pencil size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
