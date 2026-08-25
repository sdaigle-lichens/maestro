// The launch-time proof that the Agent SDK works where the app actually runs.
//
// This is deliberately not a button and not an IPC channel. The failure it exists to catch —
// an SDK that was bundled instead of externalized, or one left to find `node` on a PATH that a
// desktop launcher never built — shows up only in a packaged build started from a desktop entry,
// where there is no terminal to read and no renderer surface has been designed yet. So it is an
// env-gated startup query that leaves a file behind:
//
//   MAESTRO_AGENT_SDK_SMOKE=1                 → <userData>/agent-sdk-smoke.json
//   MAESTRO_AGENT_SDK_SMOKE=/tmp/smoke.json   → exactly there
//
// Unset (every real launch), nothing runs and nothing is spawned. When the pane arrives (task 019)
// this goes: a live session is a better proof than a receipt.

import { app } from "electron";
import path from "node:path";
import { runAgentSdkSmoke, writeSmokeReceipt, type AgentSdkSmokeResult } from "../core/index.js";

const SMOKE_ENV_VAR = "MAESTRO_AGENT_SDK_SMOKE";
const DEFAULT_RECEIPT = "agent-sdk-smoke.json";

/** Where the receipt goes: the variable's value when it names a path, else the app's data dir. */
function receiptPath(value: string): string {
  return path.isAbsolute(value) ? value : path.join(app.getPath("userData"), DEFAULT_RECEIPT);
}

/**
 * Run the smoke query if this launch asked for one. Resolves to null when it did not.
 *
 * Never rejects and never blocks the window: `runAgentSdkSmoke` reports its failures as results,
 * and the caller does not await this.
 */
export async function maybeRunAgentSdkSmoke(): Promise<AgentSdkSmokeResult | null> {
  const value = process.env[SMOKE_ENV_VAR];
  if (!value) return null;

  const file = receiptPath(value);
  const result = await runAgentSdkSmoke({ cwd: app.getAppPath() });

  try {
    writeSmokeReceipt(file, result);
  } catch (err) {
    // A receipt we could not write is still a result worth printing — a `dev` run has a terminal.
    console.error(`[agent-sdk-smoke] could not write ${file}:`, err);
  }

  // One line, both channels. The file is for a desktop-entry launch; this is for `dev`.
  console.log(
    `[agent-sdk-smoke] ok=${result.ok} billing=${result.billing} sdk=${result.sdkVersion} ` +
      `cli=${result.cliVersion} bin=${result.bin} receipt=${file}` +
      (result.error ? ` error=${result.error}` : "")
  );

  return result;
}
