#!/usr/bin/env bash
# SessionEnd hook — two responsibilities:
#   1. Remove ONLY THE ENDING SESSION'S state (`064`): .claude/maestro_sessions/<session_id>/, plus
#      the three pre-`064` flat files (maestro_session.json, maestro_session.log.jsonl,
#      maestro_session_tasks.json) if an older runtime left them. A sibling session's directory is
#      never touched, and with no session id resolvable nothing is removed at all. The decision is
#      `removeSessionState` in lib/maestro-session.cjs — the SAME function the project-local .cjs
#      twin calls, so the two cannot disagree about what SessionEnd deletes. The source of truth
#      (.claude/maestro.json) and the orchestrator skill are intentionally preserved.
#   2. SWEEP `.claude/channels/` (`036`) — a channel file is no longer flushed at SessionEnd, since
#      a lane the receiving agent hasn't run yet (an abandoned `human review` stop is the routine
#      case) still has to survive it. Sweeping instead retires `.consumed/` outright and ages out
#      anything left in a live lane past the cap, via the SAME `sweep()` every other channel
#      operation goes through — see apps/maestro/src/core/handoff-channels.ts.
#
# It used to also tear down a per-project ai-tools-manager container, reference-counted across
# live sessions via marker files under /tmp. There is no container: the desktop app
# (apps/maestro) is the UI, and it is a normal application the user opens and closes. What
# survived that removal is exactly the block below — deleting the whole script instead would
# have left ephemeral session state on disk forever, and nothing would have failed loudly.
#
# The project-local twin is maestro-session-cleanup.cjs, which the installer copies into
# <project>/.claude/scripts/. This one runs from the plugin; that one runs from the project.

set -euo pipefail

STDIN_DATA=$(cat)

cwd=$(echo "$STDIN_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null || echo "")
# `064`: the payload's session_id, empty when absent. An empty string is not a valid session id, so
# resolveSessionId falls through to CLAUDE_CODE_SESSION_ID and then to null — exactly as in the
# .cjs twin, which is why the id is passed through rather than defaulted here.
session_id=$(echo "$STDIN_DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id') or '')" 2>/dev/null || echo "")

if [[ -n "$cwd" ]]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  node -e '
    const lib = require(process.argv[1]);
    const path = require("path");
    const [, , cwd, sessionId] = process.argv;
    lib.removeSessionState(path.join(cwd, ".claude"), lib.resolveSessionId(sessionId ? { session_id: sessionId } : null));
    lib.sweep(cwd);
  ' "$script_dir/lib/maestro-session.cjs" "$cwd" "$session_id" 2>/dev/null || true
fi

exit 0
