// `147` gap 4: ChannelsCard's lane rows carry the scope in their data-testid, so the same receiver
// pending in several scopes (or in a legacy unscoped lane) never repeats a testid.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ChannelLanes from "../../src/renderer/src/components/channel-lanes.js";
import type { PendingLane } from "../../src/shared/ipc.js";

function lane(scope: string | null, receiver: string): PendingLane {
  return { scope, receiver, count: 1, current: 1, stranded: 0, oldestAgeMs: 0 } as PendingLane;
}

describe("ChannelLanes testids", () => {
  it("are unique across scopes that share a receiver, legacy included", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelLanes, {
        lanes: [lane("task-147", "test"), lane("task-148", "test"), lane("ab12cd34", "test"), lane(null, "test")],
      })
    );
    const ids = [...html.matchAll(/data-testid="(channel-lane-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toContain("channel-lane-task-147/test");
    expect(ids).toContain("channel-lane-legacy/test");
  });
});
