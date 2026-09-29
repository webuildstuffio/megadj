/**
 * write-plan.test.ts — Tests for write plan/apply (B10.3).
 */
import { describe, expect, test } from "bun:test";
import {
  buildWritePlan,
  formatWritePlan,
  type WriteChange,
} from "./write-plan";

describe("buildWritePlan", () => {
  test("empty changes → empty plan", () => {
    const plan = buildWritePlan([]);
    expect(plan.changes).toHaveLength(0);
    expect(plan.tracksAffected).toBe(0);
  });

  test("filters out no-op changes", () => {
    const changes: WriteChange[] = [
      {
        trackId: "t1",
        title: "Track",
        artist: "Artist",
        field: "comment",
        oldValue: "8A · E6",
        newValue: "8A · E6",
      },
      {
        trackId: "t1",
        title: "Track",
        artist: "Artist",
        field: "colour",
        oldValue: "5",
        newValue: "3",
      },
    ];
    const plan = buildWritePlan(changes);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]!.field).toBe("colour");
  });

  test("groups by field and track", () => {
    const changes: WriteChange[] = [
      {
        trackId: "t1",
        title: "A",
        artist: "A",
        field: "comment",
        oldValue: null,
        newValue: "8A · E6",
      },
      {
        trackId: "t1",
        title: "A",
        artist: "A",
        field: "colour",
        oldValue: "0",
        newValue: "5",
      },
      {
        trackId: "t2",
        title: "B",
        artist: "B",
        field: "comment",
        oldValue: null,
        newValue: "11B · E8",
      },
    ];
    const plan = buildWritePlan(changes);
    expect(plan.tracksAffected).toBe(2);
    expect(plan.byField.get("comment")).toBe(2);
    expect(plan.byField.get("colour")).toBe(1);
  });
});

describe("formatWritePlan", () => {
  test("produces readable output", () => {
    const changes: WriteChange[] = [
      {
        trackId: "t1",
        title: "Deep Track",
        artist: "DJ House",
        field: "comment",
        oldValue: null,
        newValue: "8A · E6 · house",
      },
    ];
    const plan = buildWritePlan(changes);
    const lines = formatWritePlan(plan);
    expect(lines.join("\n")).toContain("1 changes across 1 tracks");
    expect(lines.join("\n")).toContain("Deep Track");
  });
});
