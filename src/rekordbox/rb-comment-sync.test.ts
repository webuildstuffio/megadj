import { describe, expect, test } from "bun:test";
import { commentSyncScript } from "./rb-comment-sync.js";

describe("rb-comment-sync", () => {
  test("script never clobbers non-empty comments and reads TXXX only", () => {
    const s = commentSyncScript();
    // hard skip when a comment already exists — the never-clobber rule
    expect(s).toContain('(c.Commnt or "").strip()');
    expect(s).toContain("alreadyHad");
    // reads the FullTags TXXX frames
    expect(s).toContain("CAMELOT");
    expect(s).toContain("ENERGY");
    expect(s).toContain("MOOD");
    // per-row commit, never a bulk flush
    expect(s).toContain("db.session.commit()");
  });

  test("script formats comments as Key · E · Mood (BPM never enters)", () => {
    const s = commentSyncScript();
    expect(s).toContain('" · ".join(parts)');
    expect(s).not.toContain("BPM"); // BPM has its own RB column (AGENTS.md)
  });
});
