import { describe, expect, it } from "bun:test";
import {
  normalizeNote,
  noteEvent,
  noteFromEvent,
  NOTE_MAX,
} from "../src/notes";

describe("agent notes (O88)", () => {
  it("normalizes: trims, clamps origin, defaults severity", () => {
    const v = normalizeNote({
      drive_id: "  d1  ",
      note: "  firmware looks stale  ",
      origin: `mcp:${"x".repeat(100)}`,
      severity: "warn" as const,
    });
    expect(v.drive_id).toBe("d1");
    expect(v.note).toBe("firmware looks stale");
    expect(v.origin.length).toBeLessThanOrEqual(40);
    expect(v.severity).toBe("warn");
    const plain = normalizeNote({ drive_id: "d1", note: "n" });
    expect(plain.origin).toBe("mcp");
    expect(plain.severity).toBe("info");
  });

  it("rejects empty and oversized notes with clean messages", () => {
    expect(() => normalizeNote({ drive_id: "d1", note: "   " })).toThrow(
      "note is required",
    );
    expect(() => normalizeNote({ drive_id: "", note: "x" })).toThrow(
      "drive_id is required",
    );
    expect(() =>
      normalizeNote({ drive_id: "d1", note: "a".repeat(NOTE_MAX + 1) }),
    ).toThrow("note too long");
  });

  it("round-trips through the timeline event shape", () => {
    const v = normalizeNote({
      drive_id: "d1",
      note: "flagged firmware",
      origin: "mcp:deadbeef",
      severity: "critical",
    });
    const ev = noteEvent({
      id: "ev1",
      drive_id: v.drive_id,
      note: v.note,
      origin: v.origin,
      severity: v.severity,
      at: 1234,
      dismissed_at: null,
    });
    expect(ev.kind).toBe("agent-note");
    const back = noteFromEvent({
      id: ev.id,
      drive_id: ev.drive_id,
      at: ev.at,
      kind: ev.kind,
      data: ev.data,
    });
    expect(back).toMatchObject({
      id: "ev1",
      note: "flagged firmware",
      origin: "mcp:deadbeef",
      severity: "critical",
      dismissed_at: null,
    });
  });

  it("non-note events and corrupt payloads read as null/defaults", () => {
    expect(
      noteFromEvent({
        id: "e2",
        drive_id: "d1",
        at: 1,
        kind: "job-queued",
        data: {},
      }),
    ).toBeNull();
    expect(
      noteFromEvent({ id: "e3", drive_id: "d1", at: 1, kind: "agent-note", data: {} }),
    ).toBeNull(); // missing note text
  });
});
