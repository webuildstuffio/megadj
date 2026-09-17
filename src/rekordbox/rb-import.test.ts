import { describe, expect, test } from "bun:test";
import { __test } from "./rb-import";
import { AUDIO_EXTS } from "../shared/audio-exts";

const verifyResult = (overrides: Record<string, unknown>) =>
  __test.parseVerifyOutput(
    JSON.stringify({
      hit: 2,
      broken: 0,
      total: 2,
      playlistRows: 2,
      contiguous: true,
      playlistExists: true,
      ...overrides,
    }),
  );

describe("rb-import subprocess boundaries", () => {
  test("write output preserves a 64-bit playlist id as decimal text", () => {
    const id = "9007199254740993";
    const result = __test.parseWriteOutput(
      JSON.stringify({
        inserted: 1,
        already: 0,
        gated: 0,
        linked: 1,
        playlistId: id,
        parentId: "9007199254740995",
        errors: [],
      }),
    );
    expect(result.playlistId).toBe(id);
    expect(__test.writeScript()).toContain('out["playlistId"] = str(pl.ID)');
  });

  test("write and verify payloads reject empty or malformed schemas", () => {
    for (const payload of ["{}", "null", "[]", '{"inserted":"1"}']) {
      expect(() => __test.parseWriteOutput(payload), payload).toThrow();
    }
    for (const payload of ["{}", "null", '{"hit":1,"broken":0}']) {
      expect(() => __test.parseVerifyOutput(payload), payload).toThrow();
    }
  });

  test("counter mismatches and collection breakage fail verification", () => {
    const py = __test.parseWriteOutput(
      '{"inserted":2,"already":0,"gated":0,"linked":2,"playlistId":"42","parentId":null,"errors":[]}',
    );
    expect(__test.verificationError(2, py, verifyResult({ hit: 1 }))).toContain(
      "1/2",
    );
    expect(
      __test.verificationError(2, py, verifyResult({ broken: 1 })),
    ).toContain("missing file path");
    expect(__test.verificationError(3, py, verifyResult({}))).toContain(
      "accounted for 2/3",
    );
    expect(
      __test.verificationError(2, py, verifyResult({ total: 1 })),
    ).toContain("impossible counters");
    expect(
      __test.verificationError(2, py, verifyResult({ playlistRows: 1 })),
    ).toContain("1/2 playlist");
    expect(
      __test.verificationError(2, py, verifyResult({ playlistExists: false })),
    ).toContain("playlist row");
  });

  test("same-name files use case-folded full paths and both writers use the twin seam", () => {
    const script = __test.writeScript();
    expect(script).toContain("existing[path_key(c.FolderPath)] = c.ID");
    expect(script).toContain("return nfc(s).casefold()");
    expect(script).toContain("existing.get(path_key(full))");
    expect(script).toContain(
      "expected_parent_id = parent.ID if parent is not None else 0",
    );
    expect(script).toContain("str(p.ParentID or 0) == str(expected_parent_id)");
    expect(script).not.toContain("fname in existing");
    expect(script).toContain(
      "playlist membership for both new and already-imported",
    );

    const source = Bun.file(new URL("rb-import.ts", import.meta.url));
    expect(source.text()).resolves.toContain("applyPlaylistTwinMutation({");
  });

  test("root playlists and groups never reuse a nested same-name row", () => {
    const script = __test.writeScript();
    expect(script).toContain("def find_playlist(name, attr, parent_id):");
    expect(script).toContain("DjmdPlaylist.ParentID == parent_id");
    expect(script).toContain("find_playlist(group_name, 1, 0)");
    expect(script).toContain(
      "find_playlist(playlist_name, 0, parent.ID if parent else 0)",
    );
    // the ensure ladder + link rows come from rb-script-kit (the #88 seam):
    // two DjmdPlaylist constructions (group + playlist), and the
    // membership insert is the shared pyAddSongPlaylist block — the
    // hand-inlined twin is gone from this file.
    expect(script).toContain('out["parentId"] = str(parent.ID)');
    expect(script.match(/DjmdPlaylist\(ID=rid\(\)/gu)?.length).toBe(2);
    expect(script).toContain(
      "sp = DjmdSongPlaylist(ID=rid(), PlaylistID=pl.ID, ContentID=cid, TrackNo=track_no + 1,",
    );
  });

  // F11 dupe gate (#163): the idempotency key must be NFC+casefold path
  // OR acoustic fingerprint — raw string compare is how the case-variant
  // path bug (F5) and silent dupes share a root cause.
  test("write script counts gated files and never imports them", () => {
    const script = __test.writeScript();
    // the gated set rides the payload; gated files count, never insert
    expect(script).toContain('gate = {d[0] for d in payload.get("gated", [])}');
    expect(script).toContain("elif full in gate:");
    expect(script).toContain('out["gated"] += 1');
    // the 12-field payload row ends with the fingerprint (index 11)
    expect(script).toContain(
      "full, fname, title, artist, album, genre, year, duration, bitrate, bpm, key, fp = f",
    );
  });

  test("gate scan script: NFC+casefold path proof + duration-±2s candidates", () => {
    expect(__test.gateScanScript()).toContain(
      'def path_key(s: str) -> str:\n    normalized = nfc(s)\n    return normalized.casefold() if normalized else ""',
    );
    // path proof emits the incoming target; fp candidates emit bare rows
    expect(__test.gateScanScript()).toContain('"targets": [full]');
    expect(__test.gateScanScript()).toContain("abs(e_dur - dur) <= 2.0");
    // read-only: no session.commit anywhere in the scan
    expect(__test.gateScanScript()).not.toContain("commit");
  });

  test("verification counts gated files as accounted-for without rows", () => {
    // 2 files found: 1 inserted, 1 gated → verify expects exactly 1 row
    const py = __test.parseWriteOutput(
      '{"inserted":1,"already":0,"gated":1,"linked":1,"playlistId":"42","parentId":null,"errors":[]}',
    );
    expect(
      __test.verificationError(
        2,
        py,
        verifyResult({ hit: 1, playlistRows: 1 }),
      ),
    ).toBeNull();
    // short rows still fail
    expect(__test.verificationError(2, py, verifyResult({ hit: 0 }))).toContain(
      "0/1",
    );
    // gated-only accounting mismatch still fails
    expect(__test.verificationError(3, py, verifyResult({ hit: 1 }))).toContain(
      "accounted for 2/3",
    );
    // playlist rows expect the row-bearing count, never the gated file
    expect(
      __test.verificationError(
        2,
        py,
        verifyResult({ hit: 1, playlistRows: 2 }),
      ),
    ).toContain("2/1 playlist member rows");
  });

  // Issue #200: rb-import's private AUDIO_EXT set was missing .alac, so
  // an ALAC rip that reached intake was invisible to discovery — the
  // exact #69 drift class. Discovery membership IS the #69 SSOT now.
  test("discovery accepts every SSOT audio extension incl. .alac (#69/#200)", () => {
    for (const ext of [".alac", ".aac", ".ogg", ".opus", ".m4a", ".mp3"]) {
      expect(__test.AUDIO_EXTS.has(ext), ext).toBe(true);
    }
    // and it is the SSOT set itself, not a re-twin
    expect(__test.AUDIO_EXTS).toBe(AUDIO_EXTS);
  });
});
