import { useState } from "react";
import type { TreeNode } from "../utils/maestro-tree";
import type { ProjectRule } from "../utils/maestro-rules";
import type { MaestroRuleV3 } from "../utils/maestro";

type RuleSource = "project" | "vibe-rules";

interface RuleTreeProps {
  tree: TreeNode[];
  rules: ProjectRule[];
  selectedRuleIds: string[];
  ruleAssignments: MaestroRuleV3[];
  ruleSource: Record<string, RuleSource>;
  onAssign: (assignment: MaestroRuleV3) => void;
  onUnassign: (ruleId: string) => void;
}

interface TreeRowProps {
  dirPath: string;
  name: string;
  depth: number;
  rules: ProjectRule[];
  selectedRuleIds: string[];
  ruleAssignments: MaestroRuleV3[];
  ruleSource: Record<string, RuleSource>;
  onAssign: (assignment: MaestroRuleV3) => void;
  onUnassign: (ruleId: string) => void;
}

function TreeRow({
  dirPath,
  name,
  depth,
  rules: _rules,
  selectedRuleIds,
  ruleAssignments,
  ruleSource,
  onAssign,
  onUnassign,
}: TreeRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState("");

  // Assignments for this exact path
  const isRoot = dirPath === "";
  const pathAssignments = ruleAssignments.filter((a) => {
    if (isRoot) return a.scope === "project" && (!a.paths || a.paths.length === 0);
    return a.paths?.includes(`${dirPath}/**`) || a.paths?.includes(dirPath);
  });

  // Rules available to add (selected but not yet assigned to this path)
  const assignedIds = new Set(pathAssignments.map((a) => a.id));
  const availableToAdd = selectedRuleIds.filter((id) => !assignedIds.has(id));

  const handleAdd = () => {
    if (!pickerValue) return;
    if (isRoot) {
      onAssign({ id: pickerValue, scope: "project" });
    } else {
      onAssign({ id: pickerValue, paths: [`${dirPath}/**`] });
    }
    setPickerValue("");
    setPickerOpen(false);
  };

  return (
    <div
      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-(--bg-elev) group"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {/* Dir icon */}
      <span className="text-(--ink-4) text-[12px] shrink-0">{depth === 0 ? "⊟" : "▸"}</span>
      <span className="text-[13px] text-(--ink) font-mono shrink-0 min-w-0 truncate">
        {isRoot ? "(project root)" : name}
      </span>

      {/* Rule chips for this path */}
      <div className="flex flex-wrap gap-1 flex-1 min-w-0">
        {pathAssignments.map((a) => {
          const isVibe = (a.source ?? ruleSource[a.id]) === "vibe-rules";
          return (
            <span
              key={a.id}
              title={isVibe ? "Installed via vibe-rules on save" : "Project rule file moved here on save"}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-mono ${
                isVibe
                  ? "bg-amber-100 border-amber-300 text-amber-700"
                  : "bg-(--primary-dim) border-primary/30 text-primary"
              }`}
            >
              {isVibe && <span className="text-[8px] uppercase tracking-wide opacity-70">vibe</span>}
              {a.id}
              <button
                type="button"
                onClick={() => onUnassign(a.id)}
                className="hover:text-red-500 cursor-pointer focus:outline-none"
                title="Remove"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>

      {/* Add rule button */}
      {selectedRuleIds.length > 0 && (
        <div className="flex items-center gap-1 shrink-0">
          {pickerOpen ? (
            <>
              <select
                autoFocus
                value={pickerValue}
                onChange={(e) => setPickerValue(e.target.value)}
                onBlur={() => {
                  if (!pickerValue) setPickerOpen(false);
                }}
                className="text-[11px] bg-(--bg) border border-(--line) rounded px-1.5 py-0.5 text-(--ink)"
              >
                <option value="">Pick rule…</option>
                {availableToAdd.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!pickerValue}
                className="px-2 py-0.5 text-[11px] bg-primary text-white rounded cursor-pointer disabled:opacity-40"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="px-1.5 py-0.5 text-[11px] bg-(--bg-elev) border border-(--line) rounded cursor-pointer text-(--ink-2)"
              >
                ×
              </button>
            </>
          ) : (
            availableToAdd.length > 0 && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-full border border-(--line) bg-(--bg-elev) flex items-center justify-center text-(--ink-2) text-[13px] cursor-pointer focus:outline-none transition-opacity"
                title="Assign rule to this path"
              >
                +
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function RuleTree({
  tree,
  rules,
  selectedRuleIds,
  ruleAssignments,
  ruleSource,
  onAssign,
  onUnassign,
}: RuleTreeProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {/* Project root row */}
      <TreeRow
        dirPath=""
        name="(project root)"
        depth={0}
        rules={rules}
        selectedRuleIds={selectedRuleIds}
        ruleAssignments={ruleAssignments}
        ruleSource={ruleSource}
        onAssign={onAssign}
        onUnassign={onUnassign}
      />
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          dirPath={node.path}
          name={node.name}
          depth={node.depth + 1}
          rules={rules}
          selectedRuleIds={selectedRuleIds}
          ruleAssignments={ruleAssignments}
          ruleSource={ruleSource}
          onAssign={onAssign}
          onUnassign={onUnassign}
        />
      ))}
      {tree.length === 0 && <p className="text-[12px] text-subtle px-2 py-4">No subdirectories found.</p>}
    </div>
  );
}
