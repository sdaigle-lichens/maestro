#!/usr/bin/env node
// Claude Code PreToolUse hook: make Claude run `just` recipes instead of the tools they wrap.
// Zero dependencies (Node >= 18).
//
// Registered once in .claude/settings.json, for the Bash tool:
//   node "$CLAUDE_PROJECT_DIR/.claude/hooks/use-just-commands.mjs"
//
// Each level of the repo (root, apps/frontend, ...) has its own
//   <level>/.claude/hooks/use-just-commands.json
//   { "justfile": "justfile",
//     "blocked": [ { "command": "uvx ruff", "message": "Use `just lint` or `just lint-fix`." }, ... ] }
//
// A command is checked against the configs of the directory it runs in and of every parent up to the
// project root. A segment of the command (split on ; && || | newline, subshells and $(...)) is
// denied when it starts with a blocked `command` (word by word), also behind env assignments,
// wrappers (env, time, sudo, ...) and runners (uv run, uvx, npx, pnpm exec, ...). A leading
// `cd <dir> &&` changes the directory the next segments are checked in.
//
// This is a nudge, not a sandbox: `bash -c`, `eval`, scripts and variables get past it.

import fs from "node:fs";
import path from "node:path";

const CONFIG = path.join(".claude", "hooks", "use-just-commands.json");
const WRAPPERS = new Set(["env", "exec", "command", "time", "nohup", "sudo", "nice"]);
// Words that only run another command (`uv run ruff` -> `ruff`), so `ruff` is blocked through them too.
const RUNNERS = [
  // Python
  ["uv", "run"], ["uv", "tool", "run"], ["uvx"], ["poetry", "run"], ["pipenv", "run"], ["pdm", "run"], ["hatch", "run"], ["rye", "run"],
  // JavaScript
  ["npx"], ["bunx"], ["bun", "x"], ["pnpm", "exec"], ["pnpm", "dlx"], ["npm", "exec"], ["yarn", "exec"], ["yarn", "dlx"],
  // Ruby, PHP
  ["bundle", "exec"], ["bundler", "exec"], ["gem", "exec"], ["composer", "exec"],
  // Version and environment managers
  ["mise", "exec"], ["mise", "x"], ["asdf", "exec"], ["rbenv", "exec"], ["devbox", "run"],
];

const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `[use-just-commands] ${reason}`,
      },
    })
  );
  process.exit(0);
};

// Heredoc bodies are data, not commands: drop them before splitting.
const stripHeredocs = (command) => {
  const lines = command.split("\n");
  const out = [];
  let delim = null;
  let strip = false;
  for (const line of lines) {
    if (delim !== null) {
      if ((strip ? line.replace(/^\t+/, "") : line) === delim) delim = null;
      continue;
    }
    out.push(line);
    const m = /<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|([^\s;&|<>()'"\\$`]+))/.exec(line);
    if (m) {
      delim = m[2] ?? m[3] ?? m[4];
      strip = m[1] === "-";
    }
  }
  return out.join("\n");
};

// Simple commands as word lists. Quotes group words (their content is never split or scanned for
// commands), `$(`, backticks, `(`, `)`, `;`, `&`, `|` and newlines separate commands.
const parseSegments = (command) => {
  const segments = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  const text = stripHeredocs(command);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      const j = text.indexOf("'", i + 1);
      word = (word ?? "") + text.slice(i + 1, j < 0 ? text.length : j);
      i = j < 0 ? text.length : j;
    } else if (c === '"') {
      let j = i + 1;
      let value = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") j++;
        value += text[j] ?? "";
        j++;
      }
      word = (word ?? "") + value;
      i = j;
    } else if (c === "\\") {
      word = (word ?? "") + (text[i + 1] ?? "");
      i++;
    } else if (c === "#" && word === null) {
      while (i < text.length && text[i] !== "\n") i++;
      i--;
    } else if (/\s/.test(c) && c !== "\n") {
      endWord();
    } else if (c === "\n" || c === ";" || c === "&" || c === "|" || c === "(" || c === ")" || c === "`") {
      endSegment();
    } else {
      word = (word ?? "") + c;
    }
  }
  endSegment();
  return segments;
};

// The command proper: skip env assignments and wrappers, and (for `sudo -u x`, `env -i`) their flags.
const commandWords = (words) => {
  let k = 0;
  while (k < words.length && (/^\w+=/.test(words[k]) || WRAPPERS.has(words[k]))) {
    const wrapper = WRAPPERS.has(words[k]);
    k++;
    if (wrapper) while (k < words.length && words[k].startsWith("-")) k++;
  }
  const rest = words.slice(k);
  if (rest.length) rest[0] = path.posix.basename(rest[0]);
  return rest;
};

const startsWith = (words, prefix) => prefix.length > 0 && prefix.length <= words.length && prefix.every((w, i) => words[i] === w);

// The word lists a segment can be matched as: itself and what is left after a runner (`uv run ruff` -> `ruff`).
const variants = (words) => {
  const out = [words];
  for (const runner of RUNNERS) {
    if (startsWith(words, runner)) {
      let rest = words.slice(runner.length);
      while (rest[0]?.startsWith("-") && rest.length > 1) rest = rest.slice(1);
      if (rest.length) out.push(commandWords(rest));
    }
  }
  return out;
};

const readConfig = (dir) => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(dir, CONFIG), "utf8"));
    return Array.isArray(config.blocked) ? config : null;
  } catch {
    return null;
  }
};

const main = () => {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  const command = input.tool_input?.command;
  if (typeof command !== "string") return;

  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  let cwd = path.resolve(input.cwd || projectDir);
  const inProject = (p) => p === projectDir || p.startsWith(projectDir + path.sep);

  const configCache = new Map();
  // Configs from `dir` up to the project root, nearest level first.
  const levels = (dir) => {
    if (!configCache.has(dir)) {
      const found = [];
      for (let d = inProject(dir) ? dir : projectDir; ; d = path.dirname(d)) {
        const config = readConfig(d);
        if (config) found.push({ dir: d, config });
        if (d === projectDir || d === path.dirname(d)) break;
      }
      configCache.set(dir, found);
    }
    return configCache.get(dir);
  };

  for (const raw of parseSegments(command)) {
    const words = commandWords(raw);
    if (!words.length) continue;
    if (words[0] === "cd" || words[0] === "pushd") {
      if (words[1] && !words[1].startsWith("-") && !/[$~]/.test(words[1])) cwd = path.resolve(cwd, words[1]);
      continue;
    }
    for (const { dir, config } of levels(cwd)) {
      for (const entry of config.blocked) {
        const prefix = String(entry.command ?? "").split(/\s+/).filter(Boolean);
        if (!variants(words).some((v) => startsWith(v, prefix))) continue;
        const level = path.relative(projectDir, dir) || ".";
        deny(
          `Do not run \`${entry.command}\` directly (just level: ${level}). ` +
            `${entry.message ?? "Use the equivalent `just` recipe."} Run \`just --list\` in ${level} to see the recipes.`
        );
      }
    }
  }
};

try {
  main();
} catch (error) {
  // Convenience hook, not a safety one: on an internal error let the call through.
  console.error(`[use-just-commands] hook error, allowing the call: ${error?.message ?? error}`);
}
