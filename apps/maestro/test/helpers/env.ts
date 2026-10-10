// Environment pinning for tests that spawn the real scripts.
//
// An ambient variable that changes where a spawned process reads or writes must be set or deleted
// by the test, never inherited: HOME decides which `~/.claude` sqlite stores a script opens, and
// CLAUDE_CODE_SESSION_ID decides which per-session directory a hook writes into.
export function pinnedEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ...extra };
  if (!("CLAUDE_CODE_SESSION_ID" in extra)) delete env.CLAUDE_CODE_SESSION_ID;
  return env;
}
