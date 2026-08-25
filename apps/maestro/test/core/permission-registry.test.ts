// The parked promises — and the three ways they leak.
//
// Every property here is one whose failure is a WEDGED SESSION rather than a wrong answer: a
// `canUseTool` promise that never resolves means the SDK never writes a `control_response`, and
// permission prompts do not time out. There is no backstop below this. The symptom is a pane that
// goes quiet forever while a detached `claude` process sits holding the user's repository.
//
// The redelivery cases are the ones that cannot be provoked by clicking around the app: a request
// whose response was lost across a transport gap is dispatched AGAIN, by `reinitialize()` and by
// any `initialize` to a running session. Both arrive with the same request id and both must land on
// the answer that already exists.

import { describe, it, expect } from "vitest";
import { createPermissionRegistry } from "../../src/core/permission-registry.js";

describe("a parked permission request", () => {
  it("resolves with the answer it is given", async () => {
    const registry = createPermissionRegistry();
    const { fresh, answer } = registry.request("r1");
    expect(fresh).toBe(true);
    expect(registry.pending()).toEqual(["r1"]);

    expect(registry.answer("r1", { behavior: "deny", message: "no" })).toBe(true);
    await expect(answer).resolves.toEqual({ behavior: "deny", message: "no" });
    expect(registry.pending()).toEqual([]);
  });

  it("is idempotent per request id: a redelivery joins the entry that exists", async () => {
    const registry = createPermissionRegistry();
    const first = registry.request("r1");
    const second = registry.request("r1");

    // NOT a second prompt, and NOT a second parked promise. `fresh` is what the caller renders on.
    expect(second.fresh).toBe(false);
    expect(registry.pending()).toEqual(["r1"]);

    registry.answer("r1", { behavior: "allow" });
    await expect(first.answer).resolves.toEqual({ behavior: "allow" });
    await expect(second.answer).resolves.toEqual({ behavior: "allow" });
    expect(registry.pending()).toEqual([]);
  });

  it("replays the answer when a request comes back AFTER it was answered", async () => {
    // The nastier redelivery. The prompt is off the screen by then, so a fresh park would be a
    // promise with nothing left in the UI that could ever resolve it — the exact leak, arriving
    // through the door that looks like it was already closed.
    const registry = createPermissionRegistry();
    const first = registry.request("r1");
    registry.answer("r1", { behavior: "deny", message: "no", interrupt: true });
    await expect(first.answer).resolves.toEqual({ behavior: "deny", message: "no", interrupt: true });

    const again = registry.request("r1");
    expect(again.fresh).toBe(false);
    expect(registry.pending()).toEqual([]);
    await expect(again.answer).resolves.toEqual({ behavior: "deny", message: "no", interrupt: true });
  });

  it("ignores an answer for a request that is not pending", () => {
    const registry = createPermissionRegistry();
    // A double click, or a click that raced the session ending. Ordinary, and it must park nothing.
    expect(registry.answer("nope", { behavior: "allow" })).toBe(false);
    expect(registry.pending()).toEqual([]);
  });

  it("denies everything outstanding on teardown, and says which", async () => {
    const registry = createPermissionRegistry();
    const a = registry.request("r1");
    const b = registry.request("r2");

    expect(registry.denyAll("gone")).toEqual(["r1", "r2"]);
    await expect(a.answer).resolves.toEqual({ behavior: "deny", message: "gone" });
    await expect(b.answer).resolves.toEqual({ behavior: "deny", message: "gone" });
    expect(registry.pending()).toEqual([]);
  });

  it("is safe to tear down twice, and a request after teardown still parks", () => {
    const registry = createPermissionRegistry();
    registry.request("r1");
    registry.denyAll("gone");
    expect(registry.denyAll("gone")).toEqual([]);
    // Teardown is not a terminal state on the registry itself — the session owns that. What matters
    // is that a second call resolves nothing twice.
    expect(registry.request("r2").fresh).toBe(true);
  });

  it("resolves a teardown denial rather than leaving it undefined", async () => {
    // The fall-through the SDK reads as "the host answered out of band": it then writes no
    // control_response at all and the tool call blocks forever. Asserted on the value, because the
    // type alone cannot see a promise that never settles.
    const registry = createPermissionRegistry();
    const { answer } = registry.request("r1");
    registry.denyAll("the session ended");
    const decision = await answer;
    expect(decision).not.toBeUndefined();
    expect(decision.behavior).toBe("deny");
    if (decision.behavior !== "deny") return;
    expect(decision.message.trim()).not.toBe("");
  });

  it("bounds what it remembers, so a long session does not grow a map per tool call", async () => {
    const registry = createPermissionRegistry();
    for (let i = 0; i < 200; i++) {
      registry.request(`r${i}`);
      registry.answer(`r${i}`, { behavior: "allow" });
    }
    // The oldest is forgotten and asks again, which is the right failure: a re-prompt costs a click
    // and an unbounded map costs the session's memory for the life of the window.
    expect(registry.request("r0").fresh).toBe(true);
    expect(registry.request("r199").fresh).toBe(false);
  });
});
