// The Claude Code CLI command table, parsed out of the project's own documentation.
//
// PORTED FROM apps/help-server/src/utils/commands.ts. It reads `<project>/docs/claude-code.md`
// rather than a Docker-mounted `/docs`, and returns [] for a project that has no such doc — most
// projects don't, and the tab says so.
//
// The source of truth is a markdown table, deliberately: the doc is what a human maintains, and a
// second hand-kept list of commands beside it would drift the moment someone edited only one.

import fs from "node:fs";
import path from "node:path";
import type { ClaudeCommand } from "./contracts.js";

export type { ClaudeCommand };

/** Rows shaped `| `<command>` | <description> | …` — the leading cell must be inline code. */
const COMMAND_ROW = /^\|\s*`[^`]+`[^|]*\|[^|]+\|/gm;

export function claudeCommandsDocPath(projectRoot: string): string {
  return path.join(projectRoot, "docs", "claude-code.md");
}

export function readClaudeCommands(projectRoot: string): ClaudeCommand[] {
  if (!projectRoot) return [];
  let content: string;
  try {
    content = fs.readFileSync(claudeCommandsDocPath(projectRoot), "utf8");
  } catch {
    return [];
  }

  const commands: ClaudeCommand[] = [];
  for (const row of content.match(COMMAND_ROW) ?? []) {
    const cells = row
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const command = cells[0].replace(/`/g, "").trim();
    const description = cells[1].trim();
    // A leading `-` is the table's separator row (`|---|---|`), not a command.
    if (command && description && !command.startsWith("-")) commands.push({ command, description });
  }
  return commands;
}
