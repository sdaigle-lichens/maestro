#!/usr/bin/env bash
# SessionEnd hook — two responsibilities:
#   1. Remove the ephemeral Maestro session files (maestro_session.json, maestro_session.log.jsonl,
#      maestro_session_tasks.json) from the project's .claude/ directory. The source of truth
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

if [[ -n "$cwd" ]]; then
  rm -f "$cwd/.claude/maestro_session.json" "$cwd/.claude/maestro_session.log.jsonl" "$cwd/.claude/maestro_session_tasks.json"

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  node -e 'require(process.argv[1]).sweep(process.argv[2]);' "$script_dir/lib/maestro-session.cjs" "$cwd" 2>/dev/null || true
fi

exit 0
