import { describe, expect, test } from "bun:test";
import { __test } from "./rb-import";

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
        linked: 1,
        playlistId: id,
        parentId: "9007199254740995",
        errors: [],
      }),
    );
    expect(result.playlistId).toBe(id);
    expect(__test.buildScript()).toContain('out["playlistId"] = str(pl.ID)');
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
      '{"inserted":2,"already":0,"linked":2,"playlistId":"42","parentId":null,"errors":[]}',
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
    const script = __test.buildScript();
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
    const script = __test.buildScript();
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
});
