#!/usr/bin/env node
// Preflight for `pnpm --filter maestro dev`: will Electron's OS sandbox start on this machine?
//
//   node scripts/check-electron-sandbox.mjs
//
// Why: on Linux Electron sandboxes its renderers with either user namespaces or the setuid
// `chrome-sandbox` helper. Ubuntu 24.04+ blocks unprivileged user namespaces (AppArmor,
// kernel.apparmor_restrict_unprivileged_userns=1), and pnpm extracts every new `electron@*` store
// directory WITHOUT the helper's setuid bit — so after any install that re-resolves Electron the
// app aborts with "The SUID sandbox helper binary was found, but is not configured correctly".
// Two permanent answers: an AppArmor profile that covers every `electron@*` store dir (survives
// reinstalls) or the setuid bit (does not). This script accepts either, and otherwise prints the
// exact one-time root command instead of letting Electron abort with its own message.
//
// It never runs sudo and never suggests --no-sandbox. See
// .claude/skills/test-maestro/references/electron-sandbox-setup.md.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROFILE_NAME = "maestro-electron";
export const PROFILE_INSTALL_PATH = `/etc/apparmor.d/${PROFILE_NAME}`;
const APPARMOR_DIR = "/etc/apparmor.d";
const SYSCTL_PATH = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

/** The glob that covers the Electron binary in every pnpm `electron@*` store dir of this repo. */
export function electronGlob(repoRoot) {
  return `${repoRoot}/node_modules/.pnpm/electron@*/node_modules/electron/dist/electron`;
}

/** The AppArmor profile text for this repo, modelled on Ubuntu's /etc/apparmor.d/slack. */
export function generateProfile(repoRoot) {
  return [
    "abi <abi/5.0>,",
    "include <tunables/global>",
    "",
    `profile ${PROFILE_NAME} ${electronGlob(repoRoot)} flags=(unconfined) {`,
    "  userns,",
    "  @{exec_path} mrix,",
    `  include if exists <local/${PROFILE_NAME}>`,
    "}",
    "",
  ].join("\n");
}

/** True when `st` is a root-owned regular file with the setuid bit. */
export function hasSetuidRoot(st) {
  return st.uid === 0 && (st.mode & 0o4000) !== 0;
}

/**
 * Decide whether the sandbox will start. Pure: every machine fact is injected.
 *   platform        process.platform
 *   restrictedUserns  contents of the AppArmor userns sysctl, or null if unreadable/absent
 *   sandboxStat     fs.Stats-like {uid, mode} of chrome-sandbox, or null if missing
 *   profileTexts    contents of the readable files in /etc/apparmor.d
 *   repoRoot        absolute repo root
 * Returns { ok, reason }.
 */
export function decide({ platform, restrictedUserns, sandboxStat, profileTexts, repoRoot }) {
  if (platform !== "linux") return { ok: true, reason: "not linux" };
  if (sandboxStat === null) return { ok: true, reason: "electron is not installed here; nothing to check" };
  if (String(restrictedUserns ?? "").trim() !== "1") {
    return { ok: true, reason: "unprivileged user namespaces are not restricted; no helper needed" };
  }
  if (hasSetuidRoot(sandboxStat)) return { ok: true, reason: "chrome-sandbox is root:root and setuid" };
  const glob = electronGlob(repoRoot);
  if (profileTexts.some((t) => t.includes(glob))) {
    return { ok: true, reason: "an AppArmor profile covers this repo's Electron" };
  }
  return { ok: false, reason: "no AppArmor profile for this repo and chrome-sandbox is not root:root setuid" };
}

/** Read a file, tolerating ENOENT/EACCES. */
function tryRead(read, file) {
  try {
    return read(file, "utf8");
  } catch {
    return null;
  }
}

/** Gather the machine facts `decide` needs. Everything touching the OS is injectable. */
export function gather({
  repoRoot,
  platform = process.platform,
  readFile = fs.readFileSync,
  readdir = fs.readdirSync,
  stat = fs.statSync,
  realpath = fs.realpathSync,
}) {
  let sandboxPath = null;
  let sandboxStat = null;
  try {
    const dist = path.join(realpath(path.join(repoRoot, "apps/maestro/node_modules/electron")), "dist");
    sandboxPath = path.join(dist, "chrome-sandbox");
    sandboxStat = stat(sandboxPath);
  } catch {
    sandboxStat = null;
  }
  let files = [];
  try {
    files = readdir(APPARMOR_DIR);
  } catch {
    files = [];
  }
  const profileTexts = files.map((f) => tryRead(readFile, path.join(APPARMOR_DIR, f))).filter((t) => t !== null);
  return {
    platform,
    restrictedUserns: tryRead(readFile, SYSCTL_PATH),
    sandboxStat,
    profileTexts,
    repoRoot,
    sandboxPath,
  };
}

/** The message printed when the check fails. `profileFile` is where the generated profile was written. */
export function failureMessage({ profileFile, sandboxPath }) {
  return [
    "Electron's sandbox will not start on this machine.",
    "",
    "Ubuntu restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1)",
    "and no AppArmor profile covers this repo's Electron. Run this ONCE (it survives reboots and",
    "pnpm installs; it needs root, so run it yourself):",
    "",
    `  sudo install -m 644 ${profileFile} ${PROFILE_INSTALL_PATH} && sudo apparmor_parser -r ${PROFILE_INSTALL_PATH}`,
    "",
    "Fallback (lost on any install that re-resolves Electron):",
    "",
    `  sudo chown root:root ${sandboxPath ?? "<electron dist>/chrome-sandbox"} && sudo chmod 4755 ${sandboxPath ?? "<electron dist>/chrome-sandbox"}`,
    "",
    "Do not use --no-sandbox: renderer isolation from the OS is what test/isolation.test.ts defends.",
  ].join("\n");
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = fs.realpathSync(path.resolve(here, "../../.."));
  const facts = gather({ repoRoot });
  const result = decide(facts);
  if (result.ok) return 0;
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "maestro-apparmor-"));
  const profileFile = path.join(dir, PROFILE_NAME);
  fs.writeFileSync(profileFile, generateProfile(repoRoot));
  console.error(`${failureMessage({ profileFile, sandboxPath: facts.sandboxPath })}\n`);
  return 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
