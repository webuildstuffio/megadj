// deckapi-poll.test.ts — regression: pollJob (the shared job-status poll
// behind waitForJob AND deckctl run --wait) must tolerate transient poll
// failures. deckctl's inline loop had zero tolerance: one dropped poll
// (server busy mid-benchmark, brief restart) killed the CLI an hour into
// a verify with an unhandled rejection.
import { describe, expect, it } from "bun:test";
import { pollJob } from "../src/deckapi";
import type { Job } from "../shared/types";

function job(status: Job["status"]): Job {
  return {
    id: "j1",
    drive_id: "d1",
    kind: "verify",
    status,
    progress: 0.5,
    message: null,
    phase: null,
    eta_seconds: null,
    error: null,
    result_json: null,
    log_path: null,
    created_at: 0,
    started_at: 1,
    finished_at: null,
    origin: "web",
  };
}

function jsonOf(j: Job): Response {
  return new Response(JSON.stringify(j), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("pollJob transient-failure tolerance", () => {
  it("rides out dropped polls and returns once the server answers again", async () => {
    let calls = 0;
    const j = await pollJob("j1", {
      maxConsecutive: 5,
      retryDelayMs: 1,
      get: async () => {
        calls++;
        if (calls <= 3) throw new Error("ECONNREFUSED"); // server restarting
        return jsonOf(job("running"));
      },
    });
    expect(calls).toBe(4);
    expect(j.status).toBe("running");
  });

  it("gives up only after maxConsecutive consecutive failures", async () => {
    let calls = 0;
    const gaveUp: { msg: string | null } = { msg: null };
    await expect(
      pollJob("j1", {
        maxConsecutive: 3,
        retryDelayMs: 1,
        onGiveUp: (msg) => {
          gaveUp.msg = msg;
        },
        get: async () => {
          calls++;
          throw new Error("server busy");
        },
      }),
    ).rejects.toThrow("unreachable after 3 consecutive polls");
    expect(calls).toBe(3); // retried, didn't die on the first failure
    expect(gaveUp.msg).toContain("unreachable after 3 consecutive polls");
  });
});
